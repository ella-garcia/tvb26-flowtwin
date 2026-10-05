// Twin projection for the next 14 days: transit time (P10–P90 band, P50 line) against days of cover.
import { date } from "../../lib/format";
import type { ProjectionDay } from "../../lib/types";

export function ProjectionChart({ proj, normal }: { proj: ProjectionDay[]; normal: number }) {
  const W = 720, H = 300, L = 44, R = 16, T = 16, B = 40;
  const n = proj.length;
  const maxY = Math.max(1, ...proj.flatMap((p) => [p.transitP90, p.coverDays, p.transitP50]), normal);
  const top = Math.ceil(maxY + 0.5);
  const x = (i: number) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = (f: (p: ProjectionDay) => number) => proj.map((p, i) => `${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(" ");
  const band = [...proj.map((p, i) => `${x(i).toFixed(1)},${y(p.transitP90).toFixed(1)}`),
    ...[...proj].reverse().map((p, i) => `${x(n - 1 - i).toFixed(1)},${y(p.transitP10).toFixed(1)}`)].join(" ");
  const cross = proj.findIndex((p) => p.coverDays < p.transitP50);
  const step = Math.max(1, Math.ceil(top / 6));
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const short = (iso: string) => date(iso).replace(/ \d{4}$/, "");
  const xl = proj.map((_, i) => i).filter((i) => i % 2 === 0 || i === n - 1);
  const summary = cross >= 0
    ? `From ${date(proj[cross].date)}, your stock runs out before the next delivery can arrive.`
    : "Days of cover stay above the expected transit time for the next 14 days.";
  return (
    <svg className="supplier-risk-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Twin projection, next 14 days. ${summary}`}>
      {ticks.map((v) => (
        <g key={v}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>
      ))}
      <line className="axis" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      <text x={12} y={T + 4} textAnchor="start">days</text>
      {xl.map((i) => <text key={i} x={x(i)} y={H - B + 18} textAnchor="middle">{short(proj[i].date)}</text>)}
      <polygon points={band} fill="var(--projection)" opacity={0.25} />
      <line x1={L} x2={W - R} y1={y(normal)} y2={y(normal)} stroke="var(--ink-subtle)" strokeWidth={2} strokeDasharray="6 5" />
      <polyline points={line((p) => p.transitP50)} fill="none" stroke="var(--projection)" strokeWidth={2.5} strokeLinejoin="round" />
      <polyline points={line((p) => p.coverDays)} fill="none" stroke="var(--cover)" strokeWidth={2.5} strokeLinejoin="round" />
      {cross >= 0 && (
        <g>
          <line x1={x(cross)} x2={x(cross)} y1={T} y2={y(0)} stroke="var(--danger)" strokeWidth={1.5} strokeDasharray="2 3" />
          <circle cx={x(cross)} cy={y(proj[cross].coverDays)} r={6} fill="var(--surface-raised)" stroke="var(--danger)" strokeWidth={2.5} />
          <text className="supplier-risk-cross" x={Math.min(x(cross) + 8, W - 110)} y={T + 12}>Next delivery too late</text>
        </g>
      )}
    </svg>
  );
}

export function ProjectionLegend() {
  return (
    <ul className="supplier-risk-legend">
      <li><svg width="28" height="12" aria-hidden="true"><rect x="0" y="1" width="28" height="10" fill="var(--projection)" opacity="0.25" /></svg>Transit time, likely range (P10 to P90)</li>
      <li><svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke="var(--projection)" strokeWidth="2.5" /></svg>Expected transit (P50)</li>
      <li><svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke="var(--cover)" strokeWidth="2.5" /></svg>Days of cover in your stock</li>
      <li><svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke="var(--ink-subtle)" strokeWidth="2" strokeDasharray="6 5" /></svg>Normal transit</li>
      <li><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--danger)" strokeWidth="2.5" /></svg>Next delivery too late: your cover runs out before it arrives</li>
    </ul>
  );
}
