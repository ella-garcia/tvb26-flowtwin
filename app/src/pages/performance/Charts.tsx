// Performance charts. Hand-drawn SVG to scale, tokens only, every status with a word. Data comes from lib/performance.ts.
import { GradePill, RiskLight } from "../../components/shared";
import { days, num, pct } from "../../lib/format";
import type { DayPoint, KindSlice, MonthDelivery, SupplierPanel } from "../../lib/performance";

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (m: string) => `${MONTH[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const dayLabel = (d: string) => String(Number(d.slice(8, 10)));
/** A round axis maximum: 1, 2, 5, 10, 20, 50 … at or above v. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}
/** "QSS-6120-LMB" → "6120": the numeric part keeps three labels apart under narrow bars (the full number is in the label). */
const shortNumber = (n: string) => n.split("-").find((x) => /\d/.test(x)) ?? n;

// ---------------------------------------------------------------- supplier small multiples
/** One supplier: days to line stop, light and grade, and per part its cover (bar) against the next delivery (tick). */
export function SupplierMini({ panel, yMax, onOpen }: { panel: SupplierPanel; yMax: number; onOpen: () => void }) {
  const W = 200, H = 150, L = 26, R = 6, T = 18, B = 24;
  const n = Math.max(panel.parts.length, 1);
  const slot = (W - L - R) / n, bw = Math.min(30, slot * 0.55);
  const y = (v: number) => T + (H - T - B) * (1 - Math.min(v, yMax) / yMax);
  const ticks = [0, yMax / 2, yMax];
  const short = panel.parts.filter((p) => p.short).length;
  const label = `${panel.name}: ${panel.levelWord}, ${panel.daysToLineStop == null ? "no line stop expected in 14 days" : `line stop in ${days(panel.daysToLineStop)}`}. `
    + panel.parts.map((p) => `${p.number} ${num(p.coverDays, 1)} days of cover, next delivery in ${p.transitDays == null ? "unknown" : days(p.transitDays)}${p.short ? ", runs out first" : ""}`).join("; ");
  return (
    <li className="perf-mini">
      <button type="button" className="perf-mini-head" onClick={onOpen} aria-label={`View supplier ${panel.name}`}>
        <span className="perf-mini-name">{panel.name}</span>
        <span className="perf-mini-value ks-num">{panel.daysToLineStop == null ? "No stop" : days(panel.daysToLineStop)}</span>
        <span className="perf-mini-sub">{panel.daysToLineStop == null ? "in the next 14 days" : "to line stop"}</span>
      </button>
      <div className="perf-mini-tags"><RiskLight level={panel.level} />{panel.otif.grade && <GradePill grade={panel.otif.grade} />}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="perf-svg" role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="perf-grid" />
            <text x={L - 4} y={y(t) + 3} className="perf-axis" textAnchor="end">{num(t)}</text>
          </g>
        ))}
        {panel.parts.map((p, i) => {
          const cx = L + slot * i + slot / 2;
          return (
            <g key={p.partId}>
              <rect x={cx - bw / 2} y={y(p.coverDays)} width={bw} height={Math.max(0, y(0) - y(p.coverDays))}
                className={p.short ? "perf-bar-short" : "perf-bar"} />
              {/* Above the delivery tick when the two are close, so the tick never hides the value. */}
              <text x={cx} textAnchor="middle" className="perf-value"
                y={(p.transitDays != null && Math.abs(y(p.coverDays) - y(p.transitDays)) < 16 ? Math.min(y(p.coverDays), y(p.transitDays)) : y(p.coverDays)) - 5}>
                {num(p.coverDays, 1)}
              </text>
              {p.transitDays != null && (
                <g>
                  <line x1={cx - bw / 2 - 5} x2={cx + bw / 2 + 5} y1={y(p.transitDays)} y2={y(p.transitDays)} className="perf-tick-halo" />
                  <line x1={cx - bw / 2 - 5} x2={cx + bw / 2 + 5} y1={y(p.transitDays)} y2={y(p.transitDays)} className="perf-tick" />
                </g>
              )}
              <text x={cx} y={H - 6} className="perf-axis" textAnchor="middle">{shortNumber(p.number)}</text>
            </g>
          );
        })}
      </svg>
      <p className="perf-mini-foot">{short
        ? (panel.parts.length === 1 ? "Its part runs out before the next delivery" : `${short} of ${panel.parts.length} parts run out before the next delivery`)
        : panel.parts.length === 1 ? "Its part lasts until the next delivery" : "Every part shown lasts until the next delivery"}</p>
    </li>
  );
}

// ---------------------------------------------------------------- disruptions donut
const SERIES = ["perf-s1", "perf-s2", "perf-s3", "perf-s4"];
/** Suppliers affected per disruption type. The top three types get their own colour; the rest are grouped. */
export function DisruptionDonut({ slices, affected }: { slices: KindSlice[]; affected: number }) {
  if (!slices.length) return <p className="perf-note">No active disruption affects your suppliers.</p>;
  const top = slices.slice(0, 3);
  const rest = slices.slice(3);
  const shown = rest.length ? [...top, { kind: "other", label: `Other (${rest.map((r) => r.label.toLowerCase()).join(", ")})`, suppliers: rest.reduce((a, r) => a + r.suppliers, 0) }] : top;
  const total = shown.reduce((a, s) => a + s.suppliers, 0);
  const R = 64, r = 40, C = 80;
  const sweep = shown.map((s) => (2 * Math.PI * s.suppliers) / total);
  const starts = sweep.map((_, i) => -Math.PI / 2 + sweep.slice(0, i).reduce((a, v) => a + v, 0));
  const arcs = shown.map((s, i) => {
    const a0 = starts[i], a1 = starts[i] + sweep[i];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, rr: number) => `${C + rr * Math.cos(rad)} ${C + rr * Math.sin(rad)}`;
    const d = shown.length === 1
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
      : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`;
    return <path key={s.kind} d={d} className={SERIES[i]} />;
  });
  return (
    <div className="perf-donut">
      <svg viewBox="0 0 160 160" className="perf-donut-svg" role="img"
        aria-label={`${affected} suppliers affected. ${shown.map((s) => `${s.label}: ${s.suppliers}`).join("; ")}`}>
        {arcs}
        <text x={80} y={78} className="perf-donut-value" textAnchor="middle">{affected}</text>
        <text x={80} y={94} className="perf-axis" textAnchor="middle">suppliers affected</text>
      </svg>
      <ul className="perf-legend" aria-hidden="true">
        {shown.map((s, i) => (
          <li key={s.kind}><i className={SERIES[i]} /><span>{s.label}</span><b className="ks-num">{s.suppliers}</b></li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- delivered vs ordered
/** Received per month in days of usage, with the shortfall on top (red) and on-time-in-full under each month. */
export function DeliveriesChart({ months }: { months: MonthDelivery[] }) {
  if (!months.some((m) => m.lines > 0)) return <p className="perf-note">No goods receipts in this period yet. Upload receipts on the Data page.</p>;
  const W = 560, H = 230, L = 40, R = 8, T = 22, B = 44;
  const yMax = niceMax(Math.max(...months.map((m) => m.orderedDays)));
  const slot = (W - L - R) / months.length, bw = Math.min(56, slot * 0.6);
  const y = (v: number) => T + (H - T - B) * (1 - v / yMax);
  const ticks = [0, yMax / 2, yMax];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="perf-svg" role="img"
      aria-label={`Received against ordered per month, in days of usage. ${months.map((m) => `${monthLabel(m.month)}: ${num(m.receivedDays, 1)} of ${num(m.orderedDays, 1)} days received, ${num(m.shortDays, 1)} short, on time in full ${m.onTimeInFull == null ? "no data" : pct(m.onTimeInFull, 0)}`).join("; ")}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="perf-grid" />
          <text x={L - 6} y={y(t) + 4} className="perf-axis" textAnchor="end">{num(t)}</text>
        </g>
      ))}
      {months.map((m, i) => {
        const cx = L + slot * i + slot / 2;
        return (
          <g key={m.month}>
            <rect x={cx - bw / 2} y={y(m.receivedDays)} width={bw} height={y(0) - y(m.receivedDays)} className="perf-bar" />
            {m.shortDays > 0 && (
              <rect x={cx - bw / 2} y={y(m.orderedDays)} width={bw} height={Math.max(2, y(m.receivedDays) - y(m.orderedDays))} className="perf-bar-short" />
            )}
            {m.shortDays > 0 && <text x={cx} y={y(m.orderedDays) - 6} className="perf-value perf-value-short" textAnchor="middle">−{num(m.shortDays, 1)} d</text>}
            {m.lines > 0 && <text x={cx} y={Math.min(y(m.receivedDays) + 16, y(0) - 4)} className="perf-value perf-value-in" textAnchor="middle">{num(m.receivedDays)}</text>}
            <text x={cx} y={H - 26} className="perf-axis" textAnchor="middle">{monthLabel(m.month)}</text>
            <text x={cx} y={H - 10} className="perf-axis perf-axis-strong" textAnchor="middle">{m.onTimeInFull == null ? "–" : pct(m.onTimeInFull, 0)}</text>
          </g>
        );
      })}
      <text x={4} y={H - 10} className="perf-axis">OTIF</text>
    </svg>
  );
}

// ---------------------------------------------------------------- daily trend
/** Average risk score per day (line and area) with the worst and best days marked; suppliers at Act now per day below. */
export function TrendChart({ points }: { points: DayPoint[] }) {
  if (!points.some((p) => p.avgScore != null)) return <p className="perf-note">No daily snapshots yet. They are kept from the first hourly run.</p>;
  const W = 760, H = 250, L = 36, R = 12, T = 24, B = 62, STRIP = 22;
  const n = points.length;
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, n - 1);
  const yMax = niceMax(Math.max(...points.map((p) => p.avgScore ?? 0)) * 1.15);
  const y = (v: number) => T + (H - T - B) * (1 - v / yMax);
  const base = y(0);
  // Gaps split the line: one segment per run of days with a snapshot.
  const segs: { i: number; v: number }[][] = [];
  let open = false;
  points.forEach((p, i) => {
    if (p.avgScore == null) { open = false; return; }
    if (!open) { segs.push([]); open = true; }
    segs[segs.length - 1].push({ i, v: p.avgScore });
  });
  const maxRed = Math.max(1, ...points.map((p) => p.red ?? 0));
  const stripTop = H - B + 26;
  const ticks = [0, yMax / 2, yMax];
  const flagged = points.map((p, i) => ({ p, i })).filter(({ p }) => p.flag);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="perf-svg" role="img"
      aria-label={`Average supplier risk score per day over ${n} days. ${flagged.map(({ p }) => `${p.flag === "max" ? "Highest" : "Lowest"} ${num(p.avgScore!, 1)} on ${p.date}`).join("; ")}. Suppliers at Act now on the last day: ${points[n - 1].red ?? "no data"}.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="perf-grid" />
          <text x={L - 6} y={y(t) + 4} className="perf-axis" textAnchor="end">{num(t)}</text>
        </g>
      ))}
      {segs.map((seg, k) => (
        <g key={k}>
          <path d={`M ${x(seg[0].i)} ${base} ${seg.map((q) => `L ${x(q.i)} ${y(q.v)}`).join(" ")} L ${x(seg[seg.length - 1].i)} ${base} Z`} className="perf-area" />
          <polyline points={seg.map((q) => `${x(q.i)},${y(q.v)}`).join(" ")} className="perf-line" />
        </g>
      ))}
      {flagged.map(({ p, i }) => (
        <g key={p.date}>
          <circle cx={x(i)} cy={y(p.avgScore!)} r={4.5} className={p.flag === "max" ? "perf-dot-max" : "perf-dot-min"} />
          <text x={x(i)} y={y(p.avgScore!) - 9} className="perf-value" textAnchor="middle">
            {p.flag === "max" ? "▲" : "▼"} {num(p.avgScore!, 1)}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <g key={p.date}>
          {(i % 3 === 0 || i === n - 1) && <text x={x(i)} y={H - B + 14} className="perf-axis" textAnchor="middle">{dayLabel(p.date)}</text>}
          {p.red != null && p.red > 0 && (
            <rect x={x(i) - 4} y={stripTop + STRIP - (STRIP * p.red) / maxRed} width={8} height={(STRIP * p.red) / maxRed} className="perf-bar-short" />
          )}
        </g>
      ))}
      <line x1={L} x2={W - R} y1={stripTop + STRIP} y2={stripTop + STRIP} className="perf-grid" />
      <text x={4} y={stripTop + STRIP - 4} className="perf-axis">Act now</text>
    </svg>
  );
}

