// Optimization charts shared by the risk board and the What-if page. Hand-drawn SVG, tokens only, words with every status.
import { mxn, mxnUnit, num, pct } from "../../lib/format";
import type { Part, VehicleProgram } from "../../lib/types";
import "./optimization.css";

const band = (s: number) => (s >= 85 ? "Good" : s >= 60 ? "Fair" : "Poor");

/** 0-100 optimization score: no action vs with the chosen optimizations, on one track. */
export function ScoreGauge({ before, after }: { before: number; after: number }) {
  const d = after - before;
  return (
    <div className="opt-score">
      <div className="opt-score-figures">
        <div><small>No action</small><b className="ks-num">{before}</b><span>{band(before)}</span></div>
        <span className="opt-score-arrow" aria-hidden="true">→</span>
        <div><small>With optimizations</small><b className="ks-num opt-score-after">{after}</b><span>{band(after)}</span></div>
        <div className={d >= 0 ? "opt-up" : "opt-down"}>{d >= 0 ? "▲" : "▼"} {num(Math.abs(d))} points</div>
      </div>
      <div className="opt-track" role="img" aria-label={`Score ${before} with no action, ${after} with the chosen optimizations, out of 100`}>
        <span className="opt-track-fill" style={{ width: `${after}%` }} />
        <span className="opt-track-before" style={{ left: `${before}%` }} />
        <span className="opt-track-tick" style={{ left: "60%" }} /><span className="opt-track-tick" style={{ left: "85%" }} />
      </div>
      <div className="opt-track-scale" aria-hidden="true"><span>0 · Poor</span><span style={{ left: "60%" }}>60 · Fair</span><span style={{ left: "85%" }}>85 · Good</span><span>100</span></div>
    </div>
  );
}

/** Each lever on its own: risk-weeks it improves (bar) and line-down days it avoids. */
export function LeverBars({ levers }: { levers: { lever: string; improved: number; downAvoided: number; suppliers: number }[] }) {
  const shown = levers.filter((l) => l.improved > 0 || l.downAvoided > 0);
  if (!shown.length) return <p className="opt-note">No lever improves this horizon: no supplier has a known risk.</p>;
  const max = Math.max(1, ...shown.map((l) => l.improved));
  return (
    <ul className="opt-bars" aria-label="Benefit of each optimization lever on its own">
      {shown.map((l) => (
        <li key={l.lever}>
          <span className="opt-bars-label">{l.lever}</span>
          <span className="opt-bars-track"><span className="opt-bars-fill" style={{ width: `${(l.improved / max) * 100}%` }} /></span>
          <span className="opt-bars-value ks-num">{num(l.improved)} {l.improved === 1 ? "risk-week" : "risk-weeks"} better{l.downAvoided > 0 && <> · {num(l.downAvoided, 1)} line-down days avoided</>} · {l.suppliers} {l.suppliers === 1 ? "supplier" : "suppliers"}</span>
        </li>
      ))}
    </ul>
  );
}

/** Weekly line uptime: no action (dashed) vs with optimizations (solid), plus the average per model. */
export function UptimeChart({ before, after, labels, models }: {
  before: number[]; after: number[]; labels: string[];
  models: { program: VehicleProgram; before: number; after: number }[];
}) {
  const n = before.length, W = 720, H = 200, L = 46, R = 10, T = 12, B = 30;
  const lo = Math.min(0.9, ...before, ...after);
  const min = Math.floor(lo * 20) / 20;  // round down to 5%
  const x = (i: number) => L + (n <= 1 ? 0 : ((W - L - R) * i) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / (1 - min));
  const line = (vs: number[]) => vs.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const ticks = [min, (min + 1) / 2, 1];
  return (
    <>
      <svg className="opt-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Line uptime per week. No action: ${before.map((v) => pct(v, 0)).join(", ")}. With optimizations: ${after.map((v) => pct(v, 0)).join(", ")}.`}>
        {ticks.map((t) => <g key={t}><line className="opt-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text className="opt-axis" x={L - 8} y={y(t) + 4} textAnchor="end">{pct(t, 0)}</text></g>)}
        <polyline className="opt-line-before" points={line(before)} />
        <polyline className="opt-line-after" points={line(after)} />
        {after.map((v, i) => <circle key={i} className="opt-dot" cx={x(i)} cy={y(v)} r={3} />)}
        {labels.map((l, i) => <text key={l} className="opt-axis" x={x(i)} y={H - 8} textAnchor="middle">{l}</text>)}
      </svg>
      <ul className="opt-legend">
        <li><svg width="24" height="10" aria-hidden="true"><line className="opt-line-before" x1="0" x2="24" y1="5" y2="5" /></svg>No action</li>
        <li><svg width="24" height="10" aria-hidden="true"><line className="opt-line-after" x1="0" x2="24" y1="5" y2="5" /></svg>With optimizations</li>
      </ul>
      <table className="opt-table">
        <thead><tr><th scope="col">Model</th><th scope="col">Uptime, no action</th><th scope="col">With optimizations</th><th scope="col">Gain</th></tr></thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.program.id}>
              <th scope="row">{m.program.model} <small>({m.program.oem})</small></th>
              <td className="ks-num">{pct(m.before, 1)}</td><td className="ks-num">{pct(m.after, 1)}</td>
              <td className={`ks-num ${m.after > m.before ? "opt-up" : ""}`}>{m.after > m.before ? `▲ ${num((m.after - m.before) * 100, 1)} pts` : "No change"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Revenue lost per model with no action vs with optimizations; the gap is revenue protected (MXN, estimated). */
export function RevenueChart({ rows }: { rows: { program: VehicleProgram; before: number; after: number; vehiclesBefore: number; vehiclesAfter: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.before));
  if (rows.every((r) => r.before === 0)) return <p className="opt-note">No model loses production in this horizon, even with no action.</p>;
  return (
    <ul className="opt-rev" aria-label="Revenue lost per model, no action vs with optimizations">
      {rows.map((r) => (
        <li key={r.program.id}>
          <div className="opt-rev-head"><b>{r.program.model}</b> <small>{r.program.oem}</small>
            <span className="ks-num">{r.before > r.after ? <>protected <b className="opt-up">{mxn(r.before - r.after)}</b> ({num(r.vehiclesBefore - r.vehiclesAfter)} vehicles)</> : "no change"}</span></div>
          <div className="opt-rev-bar"><span className="opt-rev-before" style={{ width: `${(r.before / max) * 100}%` }} /><em className="ks-num">No action: lost {mxn(r.before)} · {num(r.vehiclesBefore)} vehicles</em></div>
          <div className="opt-rev-bar"><span className="opt-rev-after" style={{ width: `${(r.after / max) * 100}%` }} /><em className="ks-num">With optimizations: lost {mxn(r.after)} · {num(r.vehiclesAfter)} vehicles</em></div>
        </li>
      ))}
    </ul>
  );
}

/** Stock the chosen stock actions add, per critical part, from your unit costs (MXN). */
export function CostBars({ lines, notCosted, top = 8 }: { lines: { part: Part; label: string; action: string; units: number; mxn: number }[]; notCosted: string[]; top?: number }) {
  const byPart = new Map<string, { part: Part; parts: { label: string; action: string; mxn: number; units: number }[]; total: number }>();
  for (const l of lines) {
    const e = byPart.get(l.part.id) ?? { part: l.part, parts: [], total: 0 };
    e.parts.push(l); e.total += l.mxn; byPart.set(l.part.id, e);
  }
  const rows = [...byPart.values()].sort((a, b) => b.total - a.total).slice(0, top);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <>
      {rows.length === 0 ? <p className="opt-note">No stock action is chosen, so no stock is added.</p> : (
        <ul className="opt-cost" aria-label="Stock added per part by the chosen actions">
          {rows.map((r) => (
            <li key={r.part.id}>
              <span className="opt-bars-label"><b className="ks-num">{r.part.number}</b><small>{r.part.name} · {mxnUnit(r.part.unitCostMxn)} each</small></span>
              <span className="opt-bars-track">
                {r.parts.map((p, i) => <span key={i} className={`opt-cost-${p.action}`} style={{ width: `${(p.mxn / max) * 100}%` }} title={`${p.label}: ${num(p.units)} units, ${mxn(p.mxn)}`} />)}
              </span>
              <span className="opt-bars-value ks-num">{mxn(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="opt-legend">
        <li><span className="opt-key opt-cost-safety_stock" />Safety stock (+2 days)</li>
        <li><span className="opt-key opt-cost-pull_forward" />Orders pulled forward (+1.5 days)</li>
      </ul>
      {notCosted.length > 0 && <p className="opt-note">Not costed (no freight or qualification costs in your data): {notCosted.join(", ")}.</p>}
    </>
  );
}
