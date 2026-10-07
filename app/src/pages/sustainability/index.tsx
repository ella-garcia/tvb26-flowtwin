// Sustainability for the key customer (Tier 1): transport footprint, load consolidation, "resilience pays twice"
// and supplier circularity. Physical units only (km, trucks, fill %, t CO2e); no money. Estimated where marked.
// The engine computes (risk.circular, consolidation plan); this page only reads and adds up.
import { useMemo } from "react";
import { useApp } from "../../app/AppContext";
import { Card, CompanyMark, Empty, FormulaSource, ModelSelect, PageHeader, ProvenanceTag, ScopedError } from "../../components/shared";
import { ScenarioControls } from "../../components/optimization/Controls";
import { Button, DataTable, StatCard, StatusPill, type Column } from "../../keystone";
import mexico from "../../data/geo/mexico-states.json";
import { px, py } from "../risk/RiskMap";
import { circularityScore, CIRCULARITY_FORMULA, SCRAP_ROUTE_LABEL } from "../../lib/circularity";
import { date, num, pct, rowNo } from "../../lib/format";
import { ALL_PROGRAMS, modelLabel, partsOn } from "../../lib/programs";
import { everyone, scenarioChoice, type ScenarioRow } from "../../lib/scenarios";
import { footprintRows, footprintTotals, resiliencePaysTwice, toTonnes, type FootprintRow } from "../../lib/sustainability";
import { useScoped } from "../../lib/useScoped";
import type { Company, ConsolidationLoop, ConsolidationPlan, DataRequest, Share } from "../../lib/types";
import "./sustainability.css";

const NO_ROWS: ScenarioRow[] = [];
const t1 = (kg: number) => num(toTonnes(kg), 1);
const dayPlus = (iso: string, n: number) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---- map (same projection as the risk board map) ----
const DASH = ["", "7 3", "2 3", "10 3 2 3", "4 4"];

function LoopMap({ plant, loops, names, places, others }: {
  plant?: Company; loops: ConsolidationLoop[]; names: Map<string, string>; places: Map<string, { lat: number; lon: number }>; others: { id: string; lat: number; lon: number }[];
}) {
  const pts: [number, number][] = [];
  if (plant) pts.push([px(plant.lon), py(plant.lat)]);
  loops.forEach((l) => l.members.forEach((m) => { const p = places.get(m); if (p) pts.push([px(p.lon), py(p.lat)]); }));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const pad = 22, w0 = Math.max(90, Math.max(...xs) - Math.min(...xs) + 2 * pad), h0 = Math.max(70, Math.max(...ys) - Math.min(...ys) + 2 * pad);
  const w = Math.max(w0, h0 * 1.25), h = w / 1.25; // keep the frame wide, never distort
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const vb = `${(cx - w / 2).toFixed(1)} ${(cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  const fs = 9 * (w / 262), sw = 1; // text scales with the frame; strokes stay fixed (non-scaling)
  const label = (id: string) => (names.get(id) ?? id);
  return (
    <div className="sus-map-wrap">
      <svg className="sus-map" viewBox={vb} role="img"
        aria-label={`Map of the proposed loops: ${loops.map((l, i) => `loop ${i + 1} through ${l.members.map(label).join(", ")}`).join("; ")}`}>
        {mexico.paths.map((d, i) => <path key={i} className="sus-state" d={d} />)}
        {others.map((o) => <circle key={o.id} className="sus-other" cx={px(o.lon)} cy={py(o.lat)} r={fs * 0.35}><title>{label(o.id)}</title></circle>)}
        {loops.map((l, i) => {
          const pts2 = [...l.members.map((m) => places.get(m)).filter((p): p is { lat: number; lon: number } => !!p), ...(plant ? [plant] : [])];
          return (
            <g key={l.id} className={`sus-loop sus-loop-${i % 5}`}>
              <polyline points={pts2.map((p) => `${px(p.lon).toFixed(1)},${py(p.lat).toFixed(1)}`).join(" ")} strokeDasharray={DASH[i % 5] || undefined} strokeWidth={sw * 2.2} />
              {l.members.map((m, k) => { const p = places.get(m); return p ? (
                <g key={m}><circle className="sus-stop" cx={px(p.lon)} cy={py(p.lat)} r={fs * 0.6}><title>{`Loop ${i + 1}, stop ${k + 1}: ${label(m)}`}</title></circle>
                  <text className="sus-stop-no" x={px(p.lon)} y={py(p.lat) + fs * 0.34} textAnchor="middle" fontSize={fs * 0.85}>{k + 1}</text></g>) : null; })}
            </g>
          );
        })}
        {plant && (
          <g><rect className="sus-plant" x={px(plant.lon) - fs * 0.7} y={py(plant.lat) - fs * 0.7} width={fs * 1.4} height={fs * 1.4}><title>{`${plant.name} plant, ${plant.city}`}</title></rect>
            <text className="sus-label" x={px(plant.lon) + fs} y={py(plant.lat) - fs * 0.8} fontSize={fs}>{plant.name}</text></g>
        )}
      </svg>
      <ul className="sus-legend" aria-label="Map legend">
        {loops.map((l, i) => (
          <li key={l.id}><svg viewBox="0 0 34 8" aria-hidden="true"><g className={`sus-loop sus-loop-${i % 5}`}><line x1="1" y1="4" x2="33" y2="4" strokeWidth="2.2" strokeDasharray={DASH[i % 5] || undefined} /></g></svg>
            Loop {i + 1}: {l.members.map(label).join(" → ")} → plant</li>
        ))}
        <li><svg viewBox="0 0 12 12" aria-hidden="true"><rect className="sus-plant" x="1" y="1" width="10" height="10" /></svg>Your plant</li>
        <li><svg viewBox="0 0 12 12" aria-hidden="true"><circle className="sus-other" cx="6" cy="6" r="3" /></svg>Other suppliers (not in a loop)</li>
      </ul>
    </div>
  );
}

export default function SustainabilityPage() {
  const { db, go, dispatch, toggles, programId, scenario, setScenario } = useApp();
  const customerId = toggles.companyId;

  const loaded = useScoped(() => {
    const program = programId === ALL_PROGRAMS ? undefined : db.programs().find((g) => g.id === programId);
    const parts = partsOn(db.parts().filter((p) => p.customerId === customerId), program ? program.id : ALL_PROGRAMS);
    const risks = db.risks().filter((r) => r.customerId === customerId && (!program || parts.some((p) => p.supplierId === r.supplierId)));
    const companies = db.companies();
    const fp = footprintRows(risks, companies);
    const sRows: ScenarioRow[] = risks.map((risk) => ({ id: risk.supplierId, name: db.company(risk.supplierId)?.name ?? risk.supplierId, risk }));
    const suppliers = db.suppliersOf(customerId);
    return {
      program, risks, fp, sRows, suppliers, plan: db.consolidationPlan(customerId), plant: db.company(customerId),
      factor: db.factor("ef-road-artic"), shares: db.shares(), requests: db.requests(), settings: db.settings(),
      missing: risks.length - fp.length, companies,
    };
  }, [db, customerId, programId]);

  const rows = loaded.ok ? loaded.data.sRows : NO_ROWS;
  const choice = useMemo(() => scenarioChoice(rows, scenario), [rows, scenario]);
  const twice = useMemo(() => loaded.ok ? resiliencePaysTwice(loaded.data.fp, choice, scenario.weeks, rows) : null, [loaded, choice, scenario.weeks, rows]);
  if (!loaded.ok) return <ScopedError title="Sustainability" error={loaded.error} />;
  const { program, fp, plan, plant, factor, shares, requests, suppliers, settings, missing, companies } = loaded.data;
  const tot = footprintTotals(fp);
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.name ?? id;
  const factorText = factor
    ? `Emission factor: ${factor.name}, ${num(factor.value, 2)} ${factor.unit} (${factor.source}, version ${factor.version}, scope ${factor.scope}).`
    : "Emission factor not loaded yet.";

  // ---- a) footprint
  const fpCols: Column<FootprintRow>[] = [
    { key: "no", label: "No", render: (_r, i) => rowNo(i) },
    { key: "s", label: "Supplier", render: (r) => <span className="ft-name"><b>{r.name}</b><small>{r.place}</small></span> },
    { key: "km", label: "Road km", numeric: true, render: (r) => num(r.roadKm) },
    { key: "tr", label: "Trucks/wk", numeric: true, render: (r) => num(r.trucksPerWeek) },
    { key: "fill", label: "Fill", numeric: true, render: (r) => pct(r.fill, 0) },
    { key: "tk", label: "Truck-km/wk", numeric: true, render: (r) => num(r.truckKmPerWeek) },
    { key: "co2", label: "t CO₂e/wk", numeric: true, render: (r) => t1(r.co2eKgPerWeek) },
    { key: "p", label: "Provenance", render: (r) => <ProvenanceTag provenance={r.provenance} /> },
  ];

  // ---- b) consolidation
  const loops: ConsolidationPlan["loops"] = plan?.loops ?? [];
  const places = new Map(companies.map((c) => [c.id, { lat: c.lat, lon: c.lon }]));
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const inLoop = new Set(loops.flatMap((l) => l.members));
  const others = suppliers.filter((s) => !inLoop.has(s.company.id)).map((s) => ({ id: s.company.id, lat: s.company.lat, lon: s.company.lon }));
  const loopCols: Column<ConsolidationLoop>[] = [
    { key: "id", label: "Loop", render: (_l, i) => `Loop ${i + 1}` },
    { key: "m", label: "Suppliers in pickup order", render: (l) => <span className="sus-members">{l.members.map(nameOf).join(" → ")} → plant</span> },
    { key: "t", label: "Trucks/wk", numeric: true, render: (l) => `${num(l.trucksBefore)} → ${num(l.trucksAfter)}` },
    { key: "k", label: "Truck-km/wk", numeric: true, render: (l) => `${num(l.kmBefore)} → ${num(l.kmAfter)}` },
    { key: "f", label: "Fill", numeric: true, render: (l) => `${pct(l.fillBefore, 0)} → ${pct(l.fillAfter, 0)}` },
    { key: "c", label: "t CO₂e/wk", numeric: true, render: (l) => `${t1(l.co2eBeforeKg)} → ${t1(l.co2eAfterKg)}` },
    { key: "d", label: "Deliveries/wk", numeric: true, render: (l) => num(l.deliveriesPerWeek) },
    { key: "p", label: "Provenance", render: (l) => <ProvenanceTag provenance={l.provenance} /> },
  ];

  // ---- d) circularity
  const shareOf = new Map<string, Share>(shares.filter((s) => s.circular).map((s) => [s.supplierId, s]));
  const openReq = (id: string): DataRequest | undefined => requests.find((r) => r.toCompanyId === id && r.items.includes("circular") && r.status === "open");
  const ask = (supplierId: string) => dispatch({
    type: "request-circular",
    request: {
      id: `req-circ-${customerId}-${supplierId}-${Date.now()}`, fromCompanyId: customerId, toCompanyId: supplierId, items: ["circular"],
      fiscalYear: Number(db.asOf.slice(0, 4)), sentAt: db.asOf, dueDate: dayPlus(db.asOf, 30), status: "open",
    },
  });
  const circRows = suppliers.map((s) => ({ id: s.company.id, name: s.company.name, place: `${s.company.city}, ${s.company.state}`, share: shareOf.get(s.company.id) }))
    .sort((a, b) => Number(!!b.share) - Number(!!a.share) || a.name.localeCompare(b.name));
  const yes = <StatusPill tone="success">✓ Yes</StatusPill>, no = <StatusPill tone="neutral">✗ No</StatusPill>;
  const dash = <span className="sus-muted">Not given</span>;
  const circCols: Column<(typeof circRows)[number]>[] = [
    { key: "no", label: "No", render: (_r, i) => rowNo(i) },
    { key: "s", label: "Supplier", render: (r) => <span className="ft-name"><b>{r.name}</b><small>{r.place}</small></span> },
    { key: "sc", label: "Circularity score", numeric: true, render: (r) => {
      if (!r.share?.circular) return <span className="sus-muted">Not shared yet</span>;
      const c = circularityScore(r.share.circular);
      return <span title={c.missing.length ? `Not given: ${c.missing.join(", ")}` : undefined}>{num(c.score)} of 100</span>;
    } },
    { key: "scrap", label: "Scrap rate and route", render: (r) => {
      const c = r.share?.circular; if (!c) return "";
      return `${c.scrapRate != null ? pct(c.scrapRate) : "Rate not given"} · ${SCRAP_ROUTE_LABEL[c.scrapRoute] ?? "Unknown"}`;
    } },
    { key: "rec", label: "Recycled content", numeric: true, render: (r) => { const c = r.share?.circular; return !c ? "" : c.recycledContentPct != null ? pct(c.recycledContentPct, 0) : dash; } },
    { key: "pk", label: "Returnable packaging", numeric: true, render: (r) => { const c = r.share?.circular; return !c ? "" : c.returnablePackagingPct != null ? pct(c.returnablePackagingPct, 0) : dash; } },
    { key: "el", label: "Renewable electricity", numeric: true, render: (r) => { const c = r.share?.circular; return !c ? "" : c.renewableElectricityPct != null ? pct(c.renewableElectricityPct, 0) : dash; } },
    { key: "iso", label: "ISO 14001", render: (r) => { const c = r.share?.circular; return !c ? "" : c.iso14001 ? yes : no; } },
    { key: "src", label: "Source", render: (r) => {
      if (r.share?.circular) return <span className="sus-src"><StatusPill tone="warning">Self-reported · Estimated</StatusPill><small>Shared {date(r.share.approvedAt)}</small></span>;
      const req = openReq(r.id);
      return req
        ? <span className="sus-src"><StatusPill tone="neutral">Asked on {date(req.sentAt)}</StatusPill><small>Due {date(req.dueDate)}</small></span>
        : <Button variant="secondary" size="sm" aria-label={`Ask ${r.name} for its circular summary`} onClick={() => ask(r.id)}>Ask for it</Button>;
    } },
  ];

  return (
    <>
      <PageHeader title="Sustainability" logo={plant && <CompanyMark name={plant.name} />} actions={<ModelSelect />}
        caption="Transport footprint, load consolidation and supplier circularity. Physical units only; estimated where marked." />
      {program && <p className="sus-note">Showing suppliers that deliver parts for {modelLabel(program)}. Their footprint counts all their deliveries to you.</p>}

      {/* a) footprint */}
      <Card title="Transport footprint" actions={<ProvenanceTag provenance={tot.provenance} />}>
        {fp.length === 0 ? (
          <Empty title="Footprint not calculated yet">{`The engine adds trucks per week, fill and CO₂e for each supplier at the next risk recompute.${missing ? ` ${missing} supplier${missing === 1 ? "" : "s"} still waiting.` : ""}`}</Empty>
        ) : (
          <>
            <div className="ft-stats">
              <StatCard label="Truck-km per week" value={num(tot.truckKmPerWeek)} icon="truck" />
              <StatCard label="Trucks per week" value={num(tot.trucksPerWeek)} icon="truck" />
              <StatCard label="Average fill" value={pct(tot.avgFill, 0)} icon="chart" />
              <StatCard label="t CO₂e per week (estimated)" value={t1(tot.co2eKgPerWeek)} icon="leaf" tone="accent" />
            </div>
            <DataTable caption="Suppliers sorted by t CO₂e per week" columns={fpCols} rows={fp} />
            {missing > 0 && <p className="sus-note">{missing} supplier{missing === 1 ? " has" : "s have"} no footprint yet and {missing === 1 ? "is" : "are"} not counted.</p>}
          </>
        )}
        <FormulaSource
          formula={`Trucks per week = ceil(pallets per week ÷ ${num(settings.palletsPerTruck ?? 24)} pallets per truck). Fill = pallets ÷ (trucks × ${num(settings.palletsPerTruck ?? 24)}). Truck-km per week = trucks × road km × 2 (round trip). t CO₂e per week = truck-km × emission factor ÷ 1,000. Road km = route legs when known, otherwise straight line × 1.3. ${factorText}`}
          data="Daily usage and units per pallet of each supplier's parts (a pack default where units per pallet is missing, marked Estimated), supplier and plant locations. Weekly average over 5 production days."
          provenance="estimated" />
      </Card>

      {/* b) consolidation */}
      <Card title="Consolidation opportunities" actions={<ProvenanceTag provenance="estimated" />}>
        {!plan ? (
          <Empty title="No consolidation plan yet">Loops appear after the next risk recompute, once suppliers have a footprint.</Empty>
        ) : (
          <>
            <div className="ft-stats sus-stats3">
              <StatCard label="Trucks per week saved" value={num(plan.totals?.trucksSaved ?? 0)} icon="truck" />
              <StatCard label="Truck-km per week saved" value={num(plan.totals?.kmSaved ?? 0)} icon="truck" />
              <StatCard label="t CO₂e per week saved (estimated)" value={t1(plan.totals?.co2eSavedKg ?? 0)} icon="leaf" />
            </div>
            {loops.length === 0 ? (
              <Empty title="No loops worth proposing">Today's deliveries are already well filled, or suppliers are too far apart to share a truck.</Empty>
            ) : (
              <>
                <DataTable caption="Proposed loops, today → with the loop" columns={loopCols} rows={loops} />
                <p className="sus-note"><b>Never fewer deliveries than today.</b> A loop keeps every member's current delivery frequency, so your days of cover do not shrink.</p>
                <LoopMap plant={plant} loops={loops} names={names} places={places} others={others} />
              </>
            )}
            <h3 className="sus-sub">Excluded: at risk now</h3>
            {(plan.totals?.excluded?.length ?? 0) === 0 ? <p className="sus-note">No supplier is excluded.</p> : (
              <ul className="sus-excluded">
                {plan.totals.excluded.map((x) => <li key={x.supplierId}><b>{nameOf(x.supplierId)}</b><span>{x.reason}</span></li>)}
              </ul>
            )}
            <p className="sus-note">Suppliers at Act now, or with a line stop expected within 14 days, are never moved into a shared truck.</p>
          </>
        )}
        <FormulaSource
          formula={`Suppliers below 80% fill, within ${num(settings.milkrunRadiusKm ?? 120)} km of each other and in the same direction from your plant are grouped with a Clarke-Wright savings heuristic, limited to ${num(settings.palletsPerTruck ?? 24)} pallets a truck. A loop is accepted only if its deliveries per week are at least each member's current frequency. Saved = today − with the loop. ${factorText}`}
          data="Your own demand and supplier locations only; no supplier lanes, costs or prices."
          provenance="estimated" />
      </Card>

      {/* c) resilience pays twice */}
      <Card title="Resilience pays twice" actions={<ProvenanceTag provenance="estimated" />}>
        <p className="sus-lead">Preventing a line stop also prevents the expedited freight that usually follows it.</p>
        {fp.length === 0 || !twice ? (
          <Empty title="Footprint not calculated yet">This view multiplies avoided line-down days by each supplier's expedite distance, which the engine adds with the footprint.</Empty>
        ) : (
          <>
            <ScenarioControls compact onAll={(all) => setScenario({ overrides: everyone(rows, scenario.weeks, all) })} />
            <p className="sus-note">Next {scenario.weeks} weeks (set the horizon on What-if), draw {scenario.seed}: this scenario against no one acting.</p>
            <div className="ft-stats sus-stats3">
              <StatCard label="Line-down days avoided" value={num(twice.daysAvoided, twice.daysAvoided % 1 ? 1 : 0)} icon="pulse" />
              <StatCard label="Expedite truck-km avoided" value={num(twice.expediteKmAvoided)} icon="truck" />
              <StatCard label="t CO₂e avoided (estimated)" value={t1(twice.expediteCo2eKgAvoided)} icon="leaf" />
            </div>
            <p className="sus-tradeoff">
              {twice.extraKm > 0
                ? <>Trade-off: alternative routes add <b className="ks-num">{num(twice.extraKm)} truck-km</b> (<b className="ks-num">{t1(twice.extraCo2eKg)} t CO₂e</b>) while in place. Net: <b className="ks-num">{num(Math.abs(twice.netKm))} truck-km</b> and <b className="ks-num">{t1(Math.abs(twice.netCo2eKg))} t CO₂e</b> {twice.netCo2eKg >= 0 ? "avoided" : "added"}.</>
                : <>Trade-off: this scenario adds no alternative routes, so no extra truck-km.</>}
            </p>
          </>
        )}
        <FormulaSource
          formula={`Line-down days avoided = line-down days with no action − with the chosen actions, per supplier over the horizon (the engine's weekly short days). Expedite truck-km avoided = days avoided × expedite trips per line-down day (${num(settings.expediteTripsPerShortDay ?? 1)}) × 2 × road km, driven ${pct(settings.expediteFillRate ?? 0.3, 0)} full. t CO₂e avoided = expedite truck-km × emission factor ÷ 1,000. Alternative routes add (route factor − 1) × weekly truck-km, only in the weeks the route is actually used (weeks where switching it off changes the expected delay). ${factorText}`}
          data="Engine scenario results per supplier and action, and each supplier's footprint. The same draw as the risk board and What-if."
          provenance="estimated" />
      </Card>

      {/* d) circularity */}
      <Card title="Supplier circularity" actions={<ProvenanceTag provenance="estimated" />}>
        {suppliers.length === 0 ? (
          <Empty title="No suppliers yet" action={<button type="button" className="ft-linkbtn" onClick={() => go("invite")}>Invite a supplier</button>}>Circularity appears here once suppliers share it.</Empty>
        ) : (
          <>
            <DataTable caption="Circular practices shared by your suppliers" columns={circCols} rows={circRows} />
            <p className="sus-note">Suppliers share this by choice. Costs, prices and margins are never shared.</p>
          </>
        )}
        <FormulaSource
          formula={`${CIRCULARITY_FORMULA} Figures are what each supplier chose to share, self-reported and not audited.`}
          data="The circular summary a supplier shared with you (frozen when it approved; it can revoke it). Nothing from suppliers that have not shared."
          provenance="estimated" />
      </Card>
    </>
  );
}
