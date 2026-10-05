// Tier 1 risk board: summary, map, suppliers table. Reads via useApp().db only.
import { useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { Card, Empty, FormulaSource, NotShared, PageHeader, RiskLight } from "../../components/shared";
import { DataTable, FilterChip, IconButton, SearchField, StatCard, StatusPill, type Column } from "../../keystone";
import mexico from "../../data/geo/mexico-states.json";
import { AccessDeniedError } from "../../lib/dataLayer";
import { date, num, rowNo } from "../../lib/format";
import type { RiskAssessment, RiskLevel, Signal } from "../../lib/types";
import "./risk.css";

type Filter = "all" | RiskLevel;
interface Row {
  id: string; risk: RiskAssessment; name: string; place: string;
}

// Projection from the geo file: x=(lon+118.6)*cos(23deg)*26, y=(32.9-lat)*26.
const P = mexico.projection;
const px = (lon: number) => (lon - P.lon0) * P.cosLat * P.k;
const py = (lat: number) => (P.lat0 - lat) * P.k;
const KM_TO_PX = P.k / 111.2;
// Central Mexico: Manzanillo to Veracruz, Monterrey/Saltillo to Orizaba.
const VIEWBOX = "318 160 262 232";

const days = (n: number) => `${num(n, n % 1 ? 1 : 0)} ${n === 1 ? "day" : "days"}`;
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Mark({ level, x, y, r = 6 }: { level: RiskLevel; x: number; y: number; r?: number }) {
  const cls = `risk-dot risk-dot-${level}`;
  if (level === "red") return <polygon className={cls} points={`${x},${y - r - 1} ${x + r + 1},${y + r - 1} ${x - r - 1},${y + r - 1}`} />;
  if (level === "amber") return <polygon className={cls} points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} />;
  return <circle className={cls} cx={x} cy={y} r={r} />;
}

export default function RiskPage() {
  const { db, go, toggles } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const loaded = useMemo(() => {
    try {
      const rows: Row[] = db.risks().map((risk) => {
        const c = db.company(risk.supplierId);
        return { id: risk.supplierId, risk, name: c?.name ?? risk.supplierId, place: c ? `${c.city}, ${c.state}` : "" };
      });
      rows.sort((a, b) => {
        const da = a.risk.daysToLineStop, dbb = b.risk.daysToLineStop;
        if (da !== dbb) { if (da == null) return 1; if (dbb == null) return -1; return da - dbb; }
        return b.risk.score - a.risk.score;
      });
      return { rows, signals: db.signals(), settings: db.settings(), plant: db.company(toggles.companyId), error: null as string | null };
    } catch (e) {
      if (e instanceof AccessDeniedError) return { rows: [] as Row[], signals: [] as Signal[], settings: null, plant: undefined, error: e.message };
      throw e;
    }
  }, [db, toggles.companyId]);

  if (loaded.error) return <><PageHeader title="Supplier risk" /><NotShared message={loaded.error} /></>;
  const { rows, signals, settings, plant } = loaded;

  const count = (l: RiskLevel) => rows.filter((r) => r.risk.level === l).length;
  const stops = rows.map((r) => r.risk.daysToLineStop).filter((d): d is number => d != null);
  const soonest = stops.length ? Math.min(...stops) : null;
  const exposure = rows.reduce((a, r) => a + r.risk.lineStopExposureEur, 0);

  const shown = rows.filter((r) => (filter === "all" || r.risk.level === filter) && r.name.toLowerCase().includes(query.trim().toLowerCase()));

  const asOf = db.asOf;
  const asOfMs = new Date(asOf).getTime();
  const activeSignals = signals.filter((s) => {
    const a = new Date(s.startsAt).getTime(), b = new Date(s.endsAt).getTime();
    return !isNaN(asOfMs) && b >= asOfMs && a <= asOfMs + 14 * 864e5;
  });
  const mapped = rows.map((r) => ({ r, c: db.company(r.id) })).filter((x) => x.c);
  const cost = settings?.lineStopCostEurPerMinute ?? 15000;

  const columns: Column<Row>[] = [
    { key: "no", label: "No", render: (_r, i) => rowNo(i) },
    { key: "supplier", label: "Supplier", render: (r) => <span className="risk-name"><b>{r.name}</b><small>{r.place}</small></span> },
    { key: "risk", label: "Risk", render: (r) => <RiskLight level={r.risk.level} /> },
    { key: "stop", label: "Days to line stop", numeric: true, render: (r) => r.risk.daysToLineStop == null ? "None in 14 days" : days(r.risk.daysToLineStop) },
    { key: "transit", label: "Expected transit", numeric: true, render: (r) => `${num(r.risk.normalTransitDays, 1)} → ${num(r.risk.expectedTransitDays, 1)} days` },
    { key: "cover", label: "Lowest cover", numeric: true, render: (r) => days(r.risk.minCoverDays) },
    { key: "flex", label: "Can absorb +15%", render: (r) => <StatusPill tone={r.risk.flex.canAbsorb ? "success" : "danger"}>{r.risk.flex.canAbsorb ? "Yes" : "No"}</StatusPill> },
    { key: "exposure", label: "Exposure (€)", numeric: true, render: (r) => `€${num(r.risk.lineStopExposureEur)}` },
    { key: "data", label: "Data", render: (r) => {
      const d = r.risk.dataStatus;
      return <StatusPill tone={d === "connected" ? "success" : d === "invited" ? "neutral" : "warning"}>{d === "connected" ? "Connected" : d === "invited" ? "Invited" : "Public only"}</StatusPill>;
    } },
    { key: "act", label: "", render: (r) => <IconButton icon="eye" label={`View supplier ${r.name}`} onClick={() => go("supplier", r.id)} /> },
  ];

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" }, { id: "red", label: "Act now" }, { id: "amber", label: "Watch" }, { id: "green", label: "OK" },
  ];

  return (
    <>
      <PageHeader title="Supplier risk" caption={`14-day outlook · updated ${date(asOf)}`} />

      <div className="risk-stats">
        <StatCard label="Suppliers at Act now" value={count("red")} icon="bell" tone="accent" />
        <StatCard label="Suppliers at Watch" value={count("amber")} icon="pulse" />
        <StatCard label="Soonest line stop" value={soonest == null ? "None" : days(soonest)} icon="truck" />
        <StatCard label="Line-stop exposure (expected, next 14 days)" value={`€${num(exposure)}`} icon="chart" />
      </div>

      <Card title="Where the risk is">
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
                <text className="risk-label" x={px(plant.lon) + 9} y={py(plant.lat) - 6}>Your plant</text>
              </g>
            )}
            {[...mapped].sort((a, b) => (a.r.risk.level === "red" ? 1 : 0) - (b.r.risk.level === "red" ? 1 : 0)).map(({ r, c }) => {
              const x = px(c!.lon), y = py(c!.lat);
              const word = r.risk.level === "red" ? "Act now" : r.risk.level === "amber" ? "Watch" : "OK";
              return (
                <g key={r.id} className="risk-node" tabIndex={0} role="link" aria-label={`${r.name}, ${word}. View supplier`}
                  onClick={() => go("supplier", r.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go("supplier", r.id); } }}>
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
            <span><svg viewBox="0 0 14 14"><rect className="risk-plant" x="2" y="2" width="10" height="10" /></svg>Your plant</span>
            <span><svg viewBox="0 0 14 14"><circle className="risk-signal" cx="7" cy="7" r="5.5" /></svg>Active signal, to scale</span>
          </div>
          {activeSignals.length > 0 && (
            <ul className="risk-signal-list" aria-label="Active signals">
              {activeSignals.map((s) => <li key={s.id}><b>{s.title}</b> · {s.state} · {date(s.startsAt)} to {date(s.endsAt)}{s.transitMultiplier > 1 && ` · transit × ${num(s.transitMultiplier, 1)}`}</li>)}
            </ul>
          )}
        </div>
      </Card>

      <div className="risk-toolbar" role="group" aria-label="Filter suppliers">
        {filters.map((f) => <FilterChip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</FilterChip>)}
        <SearchField label="Search suppliers by name" placeholder="Search supplier" width={320} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <Empty title="No suppliers to show yet">Risk appears here once you invite suppliers and they accept.</Empty>
      ) : (
        <>
          <DataTable caption="Suppliers sorted by days to line stop" columns={columns} rows={shown} />
          {shown.length === 0 && <div className="risk-nodata">No suppliers match this filter.</div>}
        </>
      )}

      <FormulaSource
        formula={`Score (0–100) = sum of driver points. Red (Act now) if a line stop is expected within 3 days or score ≥ 65. Exposure = probability of stop × minutes of stoppage × €${num(cost)} per minute.`}
        data={`Signals (weather, roads, theft, ports), supplier transit history, your stock cover and the +15% demand test. The €${num(cost)} per minute comes from OEM contract terms and is still to validate.Where a supplier has not connected data, the score uses public signals only.`}
        provenance="estimated"
      />
    </>
  );
}
