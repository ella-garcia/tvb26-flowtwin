// What-if for the key customer: pick a horizon, let some suppliers act on their recommended actions (at random or by
// hand) and see the change against doing nothing. All weekly levels come from the engine (risk.scenarios).
import { useMemo } from "react";
import { useApp } from "../../app/AppContext";
import { Card, CompanyMark, FormulaSource, ModelSelect, PageHeader, ProvenanceTag, RiskLight, ScopedError } from "../../components/shared";
import { StatCard } from "../../keystone";
import { date, mxn, num } from "../../lib/format";
import { ALL_PROGRAMS, modelLabel, partsOn } from "../../lib/programs";
import { actionReturns, actionable, downDays, drawStats, everyone, flexUpside, weeklyRevenueLost, levelsFor, noneKey, optimizationView, scenarioChoice, totals, type Choice, type ScenarioRow } from "../../lib/scenarios";
import { CostBars, ReturnsTable, RevenueChart, UpsideChart, UptimeChart, WeeklyMoneyChart } from "../../components/optimization/Charts";
import { ScoreSection } from "../../components/optimization/ScoreSection";
import type { SupplierContext } from "../../lib/industry";
import { ScenarioControls } from "../../components/optimization/Controls";
import { scoped, useScoped } from "../../lib/useScoped";
import type { RiskLevel } from "../../lib/types";
import "./what-if.css";

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
  const { db, go, route, toggles, programId, scenario, setScenario } = useApp();
  const focus = route.sub;  // #what-if/<supplierId>: opened from an alert, one supplier only
  const { weeks, share, seed } = scenario;

  const loaded = useScoped(() => {
    const customerId = toggles.companyId;
    const program = db.programs().find((g) => g.id === programId);
    const parts = partsOn(db.parts().filter((p) => p.customerId === customerId), program ? program.id : ALL_PROGRAMS);
    const rows: ScenarioRow[] = db.risks().filter((r) => r.customerId === customerId && parts.some((p) => p.supplierId === r.supplierId)
      && (!focus || r.supplierId === focus))
      .map((risk) => ({ id: risk.supplierId, name: db.company(risk.supplierId)?.name ?? risk.supplierId, risk }));
    const programs = program ? [program] : db.programs().filter((g) => g.customerId === customerId);
    const rel = scoped(() => db.suppliersOf(customerId));
    const relOf = new Map(rel.ok ? rel.data.map((x) => [x.company.id, x]) : []);
    const ctx = new Map<string, SupplierContext>(rows.map((r) => [r.id, {
      parts: parts.filter((p) => p.supplierId === r.id), shareOfSales: relOf.get(r.id)?.shareOfSales, otifTarget: relOf.get(r.id)?.requirements.otifTarget }]));
    return { rows, program, programs, parts, ctx, plant: db.company(customerId), swing: db.settings()?.contractDemandSwing ?? 0.15 };
  }, [db, toggles.companyId, programId, focus]);

  const rows = loaded.ok ? loaded.data.rows : NO_ROWS;
  const choice = useMemo<Choice>(() => scenarioChoice(rows, scenario), [rows, scenario]);
  const stats = useMemo(() => drawStats(rows, share, weeks), [rows, share, weeks]);
  const opt = useMemo(() => loaded.ok ? optimizationView(rows, choice, weeks, loaded.data.programs, loaded.data.parts) : null, [loaded, rows, choice, weeks]);
  const money = useMemo(() => {
    if (!loaded.ok) return null;
    const { programs, parts, swing } = loaded.data;
    return {
      weeklyBefore: weeklyRevenueLost(downDays(rows, {}, weeks, programs, parts), programs, weeks),
      weeklyAfter: weeklyRevenueLost(downDays(rows, choice, weeks, programs, parts), programs, weeks),
      returns: actionReturns(rows, weeks, programs, parts),
      upside: flexUpside(rows, weeks, programs, parts, swing),
      swing,
    };
  }, [loaded, rows, choice, weeks]);
  if (!loaded.ok) return <ScopedError title="What-if" error={loaded.error} />;
  const { program, plant } = loaded.data;

  const base = totals(rows, {}, weeks), now = totals(rows, choice, weeks);
  const acting = rows.filter((r) => actionable(r.risk, weeks));
  const actingNow = acting.filter((r) => (choice[r.id] ?? noneKey(r.risk)).includes("1"));
  const labels = (rows.find((r) => r.risk.outlook?.length)?.risk.outlook ?? []).slice(0, weeks).map((w) => shortDate(w.weekStart));
  const sorted = [...rows].sort((a, b) => Math.max(...levelsFor(b.risk, undefined, weeks).map((l) => RANK[l]))
    - Math.max(...levelsFor(a.risk, undefined, weeks).map((l) => RANK[l])) || a.name.localeCompare(b.name));

  const toggle = (r: ScenarioRow, i: number) => {
    const key = (choice[r.id] ?? noneKey(r.risk)).split("");
    key[i] = key[i] === "1" ? "0" : "1";
    setScenario({ overrides: { ...scenario.overrides, [r.id]: key.join("") } });
  };
  const protectedMxn = opt ? opt.revenue.reduce((a, r) => a + r.before - r.after, 0) : 0;
  const stockMxn = opt ? opt.cost.lines.reduce((a, l) => a + l.mxn, 0) : 0;

  return (
    <>
      <PageHeader title="What-if" logo={plant && <CompanyMark name={plant.name} />} actions={<ModelSelect />}
        caption={`${program ? `${modelLabel(program)} · ` : ""}What changes in the next ${weeks} weeks if suppliers act on their recommendations`} />

      {focus && (
        <div className="what-if-focus" role="status">
          Showing only <b>{rows[0]?.name ?? focus}</b>: the value at risk from this supplier and what its optimizations protect.
          <button type="button" className="ft-linkbtn" onClick={() => go("what-if")}>Show all suppliers</button>
        </div>
      )}

      <Card title="Scenario">
        <ScenarioControls onAll={(all) => setScenario({ overrides: everyone(rows, weeks, all) })} />
        <p className="what-if-note">{actingNow.length} of {acting.length} suppliers with a risk in this horizon adopt their recommended optimizations (draw {seed}). Change any action below by hand. The risk board shows the same scenario.</p>
      </Card>

      {opt && (
        <Card title="Optimization score">
          <ScoreSection rows={rows} choice={choice} weeks={weeks} ctx={loaded.data.ctx} />
        </Card>
      )}

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

      {opt && (
        <Card title="Line uptime">
          <UptimeChart before={opt.uptimeBefore} after={opt.uptimeAfter} labels={labels} models={opt.models} />
        </Card>
      )}

      {opt && (
        <Card title="Revenue lost and protected (MXN, estimated)" actions={<ProvenanceTag provenance="estimated" />}>
          <p className="what-if-net ks-num">Revenue protected <b>{mxn(protectedMxn)}</b> · extra stock held <b>{mxn(stockMxn)}</b>. Stock is working capital you hold, not an expense.</p>
          <RevenueChart rows={opt.revenue} />
          <FormulaSource formula="Vehicles not built = line-down days × planned vehicles per day, per model. Revenue lost = vehicles not built × your content value per vehicle (seat set or trim you sell for that model). Protected = lost with no action − lost with the chosen optimizations." data={`Your content value per vehicle: ${opt.revenue.map((r) => `${r.program.model} ${mxn(r.program.revenuePerVehicleMxn ?? 0)}`).join(", ")} (estimated); planned vehicles per day per model.`} provenance="estimated" />
        </Card>
      )}

      {money && (
        <Card title="Revenue at risk by week (MXN, estimated)">
          <WeeklyMoneyChart before={money.weeklyBefore} after={money.weeklyAfter} labels={labels} />
          <FormulaSource formula="Per week: line-down days × planned vehicles per day × your content value per vehicle, summed over models; no action vs the chosen optimizations." data="Engine results per supplier and action, vehicle models, your content value per vehicle (estimated)." provenance="estimated" />
        </Card>
      )}

      {money && (
        <Card title="Return on each optimization (MXN, estimated)">
          <ReturnsTable rows={money.returns} />
          <FormulaSource formula="Each optimization on its own, one supplier at a time, against no action: revenue protected over the horizon, and the stock it adds (added days × daily usage × your unit cost). Protected per peso of stock = revenue protected ÷ stock added. Route, customs, security and second-source optimizations are not costed: there are no freight, broker or qualification costs in your data." data="Engine results per supplier and action, your unit costs and daily usage, your content value per vehicle (estimated)." provenance="estimated" />
        </Card>
      )}

      {money && (
        <Card title={`Revenue gained if the OEM raises volume ${Math.round(money.swing * 100)}% (MXN, estimated)`}>
          <UpsideChart rows={money.upside} swing={money.swing} />
          <FormulaSource formula={`Extra volume = ${Math.round(money.swing * 100)}% × planned vehicles per day × days in the horizon × your content value per vehicle. A supplier delivers (service level under the surge × (1 + ${Math.round(money.swing * 100)}%) − 1) ÷ ${Math.round(money.swing * 100)}% of the extra; a model can take the share of its weakest supplier of critical parts.`} data="The +15% demand test of each supplier (service level and bottleneck), vehicle models, your content value per vehicle (estimated)." provenance="estimated" />
        </Card>
      )}

      {opt && (
        <Card title="Unit costs: stock added by the chosen optimizations (MXN)">
          <CostBars lines={opt.cost.lines} notCosted={opt.cost.notCosted} />
          <FormulaSource formula="Per critical part (line-stopper or high) of each supplier that adopts a stock action: added days × daily usage × your unit cost. Safety stock adds 2 days; pulling orders forward adds 1.5 days for two weeks." data="Your parts list: unit cost and daily usage." provenance="measured" />
        </Card>
      )}

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
