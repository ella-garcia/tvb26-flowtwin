// Board map: Mexican states, suppliers marked by risk (shape + colour), your plant, and active signals drawn to scale.
import { useApp } from "../../app/AppContext";
import mexico from "../../data/geo/mexico-states.json";
import { date, num, riskWord } from "../../lib/format";
import type { Company, RiskAssessment, RiskLevel, Signal } from "../../lib/types";

// Projection from the geo file: x=(lon+118.6)*cos(23deg)*26, y=(32.9-lat)*26.
const P = mexico.projection;
const px = (lon: number) => (lon - P.lon0) * P.cosLat * P.k;
const py = (lat: number) => (P.lat0 - lat) * P.k;
const KM_TO_PX = P.k / 111.2;
// Central Mexico: Manzanillo to Veracruz, Monterrey/Saltillo to Orizaba.
const VIEWBOX = "318 160 262 232";

const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Mark({ level, x, y, r = 6 }: { level: RiskLevel; x: number; y: number; r?: number }) {
  const cls = `risk-dot risk-dot-${level}`;
  if (level === "red") return <polygon className={cls} points={`${x},${y - r - 1} ${x + r + 1},${y + r - 1} ${x - r - 1},${y + r - 1}`} />;
  if (level === "amber") return <polygon className={cls} points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} />;
  return <circle className={cls} cx={x} cy={y} r={r} />;
}

interface MapSupplier { id: string; name: string; risk: RiskAssessment }
interface Props {
  suppliers: MapSupplier[];
  plant?: Company;
  signals: Signal[];
  asOf: string;
  onOpen: (supplierId: string) => void;
}

/** Signals that overlap the 14-day outlook. Signals an admin switched off (active: false) are left out. */
function activeIn14Days(signals: Signal[], asOf: string): Signal[] {
  const asOfMs = new Date(asOf).getTime();
  return signals.filter((s) => {
    const a = new Date(s.startsAt).getTime(), b = new Date(s.endsAt).getTime();
    return s.active !== false && !isNaN(asOfMs) && b >= asOfMs && a <= asOfMs + 14 * 864e5;
  });
}

export function RiskMap({ suppliers, plant, signals, asOf, onOpen }: Props) {
  const { db } = useApp();
  const activeSignals = activeIn14Days(signals, asOf);
  const mapped = suppliers.map((r) => ({ r, c: db.company(r.id) })).filter((x) => x.c);
  return (
    <div className="risk-map-wrap">
      <svg className="risk-map" viewBox={VIEWBOX} role="group" aria-label="Map of Mexico with suppliers coloured by risk and active signals">
        {mexico.paths.map((d, i) => <path key={i} className="risk-state" d={d} />)}
        {activeSignals.map((s) => (
          <g key={s.id}>
            <circle className="risk-signal" cx={px(s.lon)} cy={py(s.lat)} r={Math.max(s.radiusKm * KM_TO_PX, 6)}>
              <title>{`${s.title} (${s.state}), ${date(s.startsAt)} to ${date(s.endsAt)}`}</title>
            </circle>
          </g>
        ))}
        {plant && (
          <g>
            <rect className="risk-plant" x={px(plant.lon) - 6} y={py(plant.lat) - 6} width={12} height={12}><title>{`${plant.name} plant, ${plant.city}`}</title></rect>
            <text className="risk-label" x={px(plant.lon) + 9} y={py(plant.lat) - 6}>{short(plant.name, 26)}</text>
          </g>
        )}
        {[...mapped].sort((a, b) => (a.r.risk.level === "red" ? 1 : 0) - (b.r.risk.level === "red" ? 1 : 0)).map(({ r, c }) => {
          const x = px(c!.lon), y = py(c!.lat);
          const word = riskWord(r.risk.level);
          return (
            <g key={r.id} className="risk-node" tabIndex={0} role="link" aria-label={`${r.name}, ${word}. View supplier`}
              onClick={() => onOpen(r.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r.id); } }}>
              <title>{`${r.name}, ${c!.city}: ${word}`}</title>
              <Mark level={r.risk.level} x={x} y={y} />
              {r.risk.level === "red" && <text className="risk-label risk-label-red" x={x + 10} y={y + 4}>{short(r.name, 30)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="risk-legend" aria-label="Map legend">
        <span><svg viewBox="0 0 14 14"><polygon className="risk-dot risk-dot-red" points="7,1 13,13 1,13" /></svg>Act now (triangle)</span>
        <span><svg viewBox="0 0 14 14"><polygon className="risk-dot risk-dot-amber" points="7,1 13,7 7,13 1,7" /></svg>Watch (diamond)</span>
        <span><svg viewBox="0 0 14 14"><circle className="risk-dot risk-dot-green" cx="7" cy="7" r="5" /></svg>OK (circle)</span>
        <span><svg viewBox="0 0 14 14"><rect className="risk-plant" x="2" y="2" width="10" height="10" /></svg>{plant ? `Your plant: ${plant.name}, ${plant.city}` : "Your plant"}</span>
        <span><svg viewBox="0 0 14 14"><circle className="risk-signal" cx="7" cy="7" r="5.5" /></svg>Active signal, to scale</span>
      </div>
      {activeSignals.length > 0 && (
        <ul className="risk-signal-list" aria-label="Active signals">
          {activeSignals.map((s) => <li key={s.id}><b>{s.title}</b> · {s.state} · {date(s.startsAt)} to {date(s.endsAt)}{s.transitMultiplier > 1 && ` · transit × ${num(s.transitMultiplier, 1)}`}</li>)}
        </ul>
      )}
    </div>
  );
}
