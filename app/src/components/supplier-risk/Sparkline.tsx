// Weekly OTIF as a small line, scaled to its own range.
import { pct } from "../../lib/format";

export function Sparkline({ values }: { values: number[] }) {
  const W = 220, H = 56, p = 6;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 0.01;
  const pts = values.map((v, i) => [p + (i / Math.max(1, values.length - 1)) * (W - 2 * p), H - p - ((v - lo) / span) * (H - 2 * p)]);
  const last = pts[pts.length - 1];
  return (
    <svg className="supplier-risk-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`On-time in-full over the last ${values.length} weeks, from ${pct(values[0])} to ${pct(values[values.length - 1])}`}>
      <polyline points={pts.map((q) => q.join(",")).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r={3.5} />
    </svg>
  );
}
