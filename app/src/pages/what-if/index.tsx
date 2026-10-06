// What-if for the key customer: pick a horizon, let some suppliers act on their recommended actions (at random or by
// hand) and see the change against doing nothing. All weekly levels come from the engine (risk.scenarios).
import { useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { Card, CompanyMark, FormulaSource, ModelSelect, PageHeader, RiskLight, ScopedError } from "../../components/shared";
import { Button, FilterChip, StatCard } from "../../keystone";
import { date, num } from "../../lib/format";
import { ALL_PROGRAMS, modelLabel, partsOn } from "../../lib/programs";
import { actionable, drawStats, levelsFor, noneKey, randomChoice, rng, totals, type Choice, type ScenarioRow } from "../../lib/scenarios";
import { useScoped } from "../../lib/useScoped";
import type { RiskLevel } from "../../lib/types";
import "./what-if.css";

const HORIZONS = [2, 4, 12] as const;
const NO_ROWS: ScenarioRow[] = [];
const SYMBOL: Record<RiskLevel, string> = { red: "▲", amber: "◆", green: "●" };
const WORD: Record<RiskLevel, string> = { red: "High", amber: "Watch", green: "OK" };
const RANK: Record<RiskLevel, number> = { red: 2, amber: 1, green: 0 };
const shortDate = (iso: string) => date(iso).replace(/ \d{4}$/, "");
const pctDrop = (a: number, b: number) => (a === 0 ? 0 : Math.round(((a - b) / a) * 100));

function Change({ before, after }: { before: number; after: number }) {
  return <span className="ks-num">{num(before)} → {num(after)}</span>;
}

function WeekChart({ before, after, labels }: { before: { high: number; watch: number }[]; after: { high: number; watch: number }[]; labels: string[] }) {
  const n = before.length, W = 720, H = 230, L = 34, R = 8, T = 10, B = 34;
  const max = Math.max(1, ...before.map((w) => w.high + w.watch), ...after.map((w) => w.high + w.watch));
  const step = (W - L - R) / n, bw = Math.min(26, step * 0.36);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = Array.from({ length: max + 1 }, (_, i) => i).filter((t) => max <= 6 || t % Math.ceil(max / 6) === 0);
  const stack = (w: { high: number; watch: number }, x: number, cls: string) => (
    <g className={cls}>
      <rect className="what-if-high" x={x} y={y(w.high)} width={bw} height={y(0) - y(w.high)} />
      <rect className="what-if-watch" x={x} y={y(w.high + w.watch)} width={bw} height={y(w.high) - y(w.high + w.watch)} />
    </g>
  );
  return (
    <svg className="what-if-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Suppliers at High or Watch per week. Before: ${before.map((w) => w.high + w.watch).join(", ")}. With actions: ${after.map((w) => w.high + w.watch).join(", ")}.`}>
      {ticks.map((t) => (
        <g key={t}><line className="what-if-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="what-if-axis" x={L - 8} y={y(t) + 4} textAnchor="end">{t}</text></g>
      ))}
      {before.map((w, i) => {
        const cx = L + step * i + step / 2;
        return (
          <g key={i}>
            {stack(w, cx - bw - 2, "what-if-before")}
            {stack(after[i], cx + 2, "what-if-after")}
            <text className="what-if-axis" x={cx} y={H - 12} textAnchor="middle">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function RangeBar({ label, base, now, p10, p50, p90 }: { label: string; base: number; now: number; p10: number; p50: number; p90: number }) {
  const max = Math.max(1, base), x = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="what-if-range">
      <div className="what-if-range-head"><b>{label}</b><span className="ks-num">no action {num(base)} · random draws {num(p10)}–{num(p90)} (median {num(p50)}) · this scenario {num(now)}</span></div>
      <div className="what-if-range-track" aria-hidden="true">
        <span className="what-if-range-band" style={{ left: x(p10), width: `calc(${x(p90)} - ${x(p10)})` }} />
        <span className="what-if-range-median" style={{ left: x(p50) }} />
        <span className="what-if-range-now" style={{ left: x(now) }} />
        <span className="what-if-range-base" style={{ left: x(base) }} />
      </div>
    </div>
  );
}

export default function WhatIfPage() {
  const { db, go, toggles, programId } = useApp();
  const [weeks, setWeeks] = useState<number>(12);
  const [share, setShare] = useState(0.5);
  const [seed, setSeed] = useState(1);
  const [overrides, setOverrides] = useState<Choice>({});

  const loaded = useScoped(() => {
    const customerId = toggles.companyId;
    const program = db.programs().find((g) => g.id === programId);
    const parts = partsOn(db.parts().filter((p) => p.customerId === customerId), program ? program.id : ALL_PROGRAMS);
    const rows: ScenarioRow[] = db.risks().filter((r) => r.customerId === customerId && parts.some((p) => p.supplierId === r.supplierId))
      .map((risk) => ({ id: risk.supplierId, name: db.company(risk.supplierId)?.name ?? risk.supplierId, risk }));
    return { rows, program, plant: db.company(customerId) };
  }, [db, toggles.companyId, programId]);

  const rows = loaded.ok ? loaded.data.rows : NO_ROWS;
  const choice = useMemo<Choice>(() => ({ ...randomChoice(rows, share, weeks, rng(seed)), ...overrides }), [rows, share, weeks, seed, overrides]);
  const stats = useMemo(() => drawStats(rows, share, weeks), [rows, share, weeks]);
  if (!loaded.ok) return <ScopedError title="What-if" error={loaded.error} />;
  const { program, plant } = loaded.data;

  const base = totals(rows, {}, weeks), now = totals(rows, choice, weeks);
  const acting = rows.filter((r) => actionable(r.risk, weeks));
  const actingNow = acting.filter((r) => (choice[r.id] ?? noneKey(r.risk)).includes("1"));
  const labels = (rows.find((r) => r.risk.outlook?.length)?.risk.outlook ?? []).slice(0, weeks).map((w) => shortDate(w.weekStart));
  const sorted = [...rows].sort((a, b) => Math.max(...levelsFor(b.risk, undefined, weeks).map((l) => RANK[l]))
    - Math.max(...levelsFor(a.risk, undefined, weeks).map((l) => RANK[l])) || a.name.localeCompare(b.name));

  const reroll = (next: { share?: number; seed?: number }) => {
    if (next.share != null) setShare(next.share);
    setSeed(next.seed ?? seed);
    setOverrides({});
  };
  const setAll = (all: boolean) => {
    const o: Choice = {};
    for (const r of rows) o[r.id] = all && actionable(r.risk, weeks) ? "1".repeat(r.risk.scenarios?.actions.length ?? 0) : noneKey(r.risk);
    setOverrides(o);
  };
  const toggle = (r: ScenarioRow, i: number) => {
    const key = (choice[r.id] ?? noneKey(r.risk)).split("");
    key[i] = key[i] === "1" ? "0" : "1";
    setOverrides({ ...overrides, [r.id]: key.join("") });
  };

  return (
    <>
      <PageHeader title="What-if" logo={plant && <CompanyMark name={plant.name} />} actions={<ModelSelect />}
        caption={`${program ? `${modelLabel(program)} · ` : ""}What changes in the next ${weeks} weeks if suppliers act on their recommendations`} />

      <Card title="Scenario">
        <div className="what-if-controls">
          <div className="ft-toolbar" role="group" aria-label="Time horizon">
            <span className="what-if-label">Horizon</span>
            {HORIZONS.map((h) => <FilterChip key={h} pressed={weeks === h} onClick={() => { setWeeks(h); setOverrides({}); }}>{`${h} weeks`}</FilterChip>)}
          </div>
          <label className="what-if-slider" htmlFor="what-if-share">
            <span className="what-if-label">Suppliers that act on their recommendations</span>
            <input id="what-if-share" type="range" min={0} max={100} step={10} value={Math.round(share * 100)}
              onChange={(e) => reroll({ share: Number(e.target.value) / 100 })} />
            <b className="ks-num">{Math.round(share * 100)}%</b>
          </label>
          <div className="ft-toolbar">
            <Button variant="primary" icon="sync" onClick={() => reroll({ seed: seed + 1 })}>Randomize who acts</Button>
            <Button variant="secondary" onClick={() => setAll(true)}>All act</Button>
            <Button variant="secondary" onClick={() => setAll(false)}>No one acts</Button>
          </div>
          <p className="what-if-note">{actingNow.length} of {acting.length} suppliers with a risk in this horizon are acting (draw {seed}). Change any action below by hand.</p>
        </div>
      </Card>

      <div className="ft-stats">
        <StatCard label="Supplier-weeks at High" value={<Change before={base.high} after={now.high} />} icon="bell" tone="accent"
          delta={base.high ? { value: `${pctDrop(base.high, now.high)}%`, direction: now.high <= base.high ? "down" : "up", good: now.high <= base.high, caption: " vs no action" } : undefined} />
        <StatCard label="Supplier-weeks at Watch" value={<Change before={base.watch} after={now.watch} />} icon="pulse"
          delta={base.watch ? { value: `${pctDrop(base.watch, now.watch)}%`, direction: now.watch <= base.watch ? "down" : "up", good: now.watch <= base.watch, caption: " vs no action" } : undefined} />
        <StatCard label="Suppliers reaching High" value={<Change before={base.suppliersHigh} after={now.suppliersHigh} />} icon="truck" />
        <StatCard label="Suppliers acting" value={`${actingNow.length} of ${acting.length}`} icon="users" />
      </div>

      <Card title="Suppliers at High or Watch, by week">
        {labels.length === 0 ? <p className="what-if-note">No outlook yet. It appears after the next risk calculation.</p> : (
          <>
            <WeekChart before={base.perWeek} after={now.perWeek} labels={labels} />
            <ul className="what-if-legend">
              <li><svg width="14" height="14" aria-hidden="true"><rect className="what-if-before what-if-legend-box" x="1" y="1" width="12" height="12" /></svg>Left bar: no action</li>
              <li><svg width="14" height="14" aria-hidden="true"><rect className="what-if-after what-if-legend-box" x="1" y="1" width="12" height="12" /></svg>Right bar: with the chosen actions</li>
              <li><svg width="14" height="14" aria-hidden="true"><rect className="what-if-high" width="14" height="14" /></svg>High</li>
              <li><svg width="14" height="14" aria-hidden="true"><rect className="what-if-watch" width="14" height="14" /></svg>Watch</li>
            </ul>
          </>
        )}
      </Card>

      <Card title={`If ${Math.round(share * 100)}% of suppliers act: 500 random draws`}>
        <RangeBar label="High supplier-weeks" base={base.high} now={now.high} {...stats.high} />
        <RangeBar label="Watch supplier-weeks" base={base.watch} now={now.watch} {...stats.watch} />
        <ul className="what-if-legend">
          <li><span className="what-if-key what-if-key-band" />Middle 80% of draws</li>
          <li><span className="what-if-key what-if-key-median" />Median</li>
          <li><span className="what-if-key what-if-key-now" />This scenario</li>
          <li><span className="what-if-key what-if-key-base" />No action</li>
        </ul>
      </Card>

      <Card title="Supplier by week">
        <div className="outlook-scroll">
          <table className="outlook-grid">
            <caption className="outlook-sr">Weekly level per supplier with the chosen actions; outlined cells improved</caption>
            <thead><tr><th scope="col">Supplier</th>{labels.map((l) => <th scope="col" key={l}>{l}</th>)}</tr></thead>
            <tbody>
              {sorted.map((r) => {
                const was = levelsFor(r.risk, undefined, weeks), is = levelsFor(r.risk, choice[r.id], weeks);
                return (
                  <tr key={r.id}>
                    <th scope="row"><button type="button" className="ft-linkbtn" onClick={() => go("supplier", r.id)}>{r.name}</button></th>
                    {is.map((l, i) => {
                      const better = RANK[l] < RANK[was[i]];
                      const text = better ? `${labels[i]}: ${WORD[was[i]]} → ${WORD[l]}` : `${labels[i]}: ${WORD[l]}`;
                      return <td key={i}><span className={`outlook-cell outlook-${l}${better ? " what-if-better" : ""}`} role="img" aria-label={text} title={text}>{SYMBOL[l]}</span></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="what-if-note">Outlined cells are better than with no action; hover a cell to see the change.</p>
      </Card>

      <Card title="Recommended actions">
        {acting.length === 0 ? <p className="what-if-note">No supplier has a known risk in the next {weeks} weeks.</p> : (
          <ul className="what-if-actions">
            {sorted.filter((r) => actionable(r.risk, weeks)).map((r) => {
              const worst = levelsFor(r.risk, undefined, weeks).reduce<RiskLevel>((a, l) => (RANK[l] > RANK[a] ? l : a), "green");
              const key = choice[r.id] ?? noneKey(r.risk);
              return (
                <li key={r.id}>
                  <div className="what-if-actions-head"><b>{r.name}</b><RiskLight level={worst} /></div>
                  {(r.risk.scenarios?.actions ?? []).map((a, i) => (
                    <label key={a.id} className="what-if-action" htmlFor={`what-if-${r.id}-${a.id}`}>
                      <input id={`what-if-${r.id}-${a.id}`} type="checkbox" checked={key[i] === "1"} onChange={() => toggle(r, i)} />
                      <span><b>{a.label}</b><small>{a.detail}</small></span>
                    </label>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
        <p className="what-if-note">{rows.length - acting.length} suppliers need no action in this horizon.</p>
      </Card>

      <FormulaSource
        formula="Each week uses the 12-week outlook rule: the largest expected delay from signals known in advance, against the cover of the supplier's critical parts (High if the delay would use it up; Watch if it uses half of it or is a day or more). Actions change the inputs: a route or customs action keeps only part of the matching signals' delay, safety stock or pulled-forward orders add cover, and a second source counts only once qualified (about 10 weeks). The engine computes every combination of each supplier's actions; this page picks the chosen one. Random draws: each supplier with a risk acts on all its recommendations with the chosen probability."
        data="Seasonal and announced signals, route legs, your stock cover, and each supplier's recommended actions."
        provenance="estimated"
      />
    </>
  );
}
