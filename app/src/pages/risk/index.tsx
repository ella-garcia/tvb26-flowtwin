// Tier 1 risk board: summary, map, suppliers table. Reads via useApp().db only.
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { Card, CompanyMark, DataStatusPill, Empty, FlexPill, FormulaSource, GradePill, ModelSelect, OtifDelta, PageHeader, RiskLight, ScopedError } from "../../components/shared";
import { DataTable, FilterChip, IconButton, SearchField, StatCard, type Column } from "../../keystone";
import { date, days, num, pct, rowNo } from "../../lib/format";
import { DEFAULT_OTIF_TARGET, otifSummary, type OtifSummary } from "../../lib/otif";
import { CRIT_RANK, partStock } from "../../lib/stock";
import { ALL_PROGRAMS, modelLabel, partsOn, stopDaysFor } from "../../lib/programs";
import { scoped, useScoped } from "../../lib/useScoped";
import type { Part, RiskAssessment, RiskLevel } from "../../lib/types";
import { RiskMap } from "./RiskMap";
import { OUTLOOK_FORMULA, OutlookGrid, OutlookLegend } from "../../components/outlook/Outlook";
import "./risk.css";

type Filter = "all" | RiskLevel;
interface Row {
  id: string; risk: RiskAssessment; name: string; place: string;
  /** Parts that run out before the next delivery arrives (lib/stock.ts, status "short"). */
  belowCover: Part[];
  partCount: number;
  /** Days to line stop for the selected model (supplier-wide when "All models"). */
  stopDays: number | null;
  /** Best (lowest) criticality rank among belowCover; 3 when none. */
  critRank: number;
  otif: OtifSummary | null;
}

export default function RiskPage() {
  const { db, go, toggles, programId } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const loaded = useScoped(() => {
    const program = programId === ALL_PROGRAMS ? undefined : db.programs().find((g) => g.id === programId);
    const parts = partsOn(db.parts(), program ? program.id : ALL_PROGRAMS);
    const rel = scoped(() => db.suppliersOf(toggles.companyId));
    const targets = new Map(rel.ok ? rel.data.map((x) => [x.company.id, x.requirements.otifTarget]) : []); // else the default target
    const rows: Row[] = db.risks().flatMap((risk) => {
      const c = db.company(risk.supplierId);
      const own = parts.filter((p) => p.supplierId === risk.supplierId && p.customerId === risk.customerId);
      if (program && own.length === 0) return []; // supplier delivers nothing for this model
      const belowCover = own.filter((p) => partStock(p, risk, db.asOf).status === "short");
      return [{
        id: risk.supplierId, risk, name: c?.name ?? risk.supplierId, place: c ? `${c.city}, ${c.state}` : "",
        stopDays: program ? stopDaysFor(risk, own) : risk.daysToLineStop,
        belowCover, partCount: own.length, critRank: Math.min(3, ...belowCover.map((p) => CRIT_RANK[p.criticality])),
        otif: otifSummary(risk.otifTrend, targets.get(risk.supplierId) ?? DEFAULT_OTIF_TARGET),
      }];
    });
    // Time to line stop first, then how critical the parts at risk are, then score. Never by money.
    rows.sort((a, b) => {
      const da = a.stopDays, dbb = b.stopDays;
      if (da !== dbb) { if (da == null) return 1; if (dbb == null) return -1; return da - dbb; }
      return a.critRank - b.critRank || b.risk.score - a.risk.score;
    });
    return { rows, program, signals: db.signals(), plant: db.company(toggles.companyId) };
  }, [db, toggles.companyId, programId]);

  if (!loaded.ok) return <ScopedError title="Supplier risk" error={loaded.error} />;
  const { rows, program, signals, plant } = loaded.data;

  const count = (l: RiskLevel) => rows.filter((r) => r.risk.level === l).length;
  const stops = rows.map((r) => r.stopDays).filter((d): d is number => d != null);
  const soonest = stops.length ? Math.min(...stops) : null;
  const partsBelow = rows.reduce((a, r) => a + r.belowCover.length, 0);
  const lineStoppersBelow = rows.reduce((a, r) => a + r.belowCover.filter((p) => p.criticality === "line-stopper").length, 0);

  const shown = rows.filter((r) => (filter === "all" || r.risk.level === filter) && r.name.toLowerCase().includes(query.trim().toLowerCase()));

  const asOf = db.asOf;
  const swing = pct(db.settings().contractDemandSwing, 0);

  const columns: Column<Row>[] = [
    { key: "no", label: "No", render: (_r, i) => rowNo(i) },
    { key: "supplier", label: "Supplier", render: (r) => <span className="ft-name"><b>{r.name}</b><small>{r.place}</small></span> },
    { key: "risk", label: "Risk", render: (r) => <RiskLight level={r.risk.level} /> },
    { key: "stop", label: program ? `Days to ${program.model} stop` : "Days to line stop", numeric: true, render: (r) => r.stopDays == null ? "None in 14 days" : days(r.stopDays) },
    { key: "transit", label: "Expected transit", numeric: true, render: (r) => `${num(r.risk.normalTransitDays, 1)} → ${num(r.risk.expectedTransitDays, 1)} days` },
    { key: "cover", label: "Lowest cover", numeric: true, render: (r) => days(r.risk.minCoverDays) },
    { key: "flex", label: `Can absorb +${swing}`, render: (r) => <FlexPill flex={r.risk.flex} compact /> },
    { key: "below", label: "Parts below cover", numeric: true, render: (r) => (
      <button type="button" className="ft-linkbtn" aria-label={`${r.belowCover.length} of ${r.partCount} parts below cover. View parts from ${r.name}`}
        onClick={() => go("parts", r.id)}>{`${r.belowCover.length} of ${r.partCount}`}</button>
    ) },
    { key: "otif", label: "OTIF (12 wk)", numeric: true, render: (r) => r.otif == null ? "No data" : (
      <span className="risk-otif">{pct(r.otif.average)}<OtifDelta change={r.otif.change} /></span>
    ) },
    { key: "grade", label: "Delivery record", render: (r) => r.otif == null ? "No data" : <GradePill grade={r.otif.grade} /> },
    { key: "data", label: "Data", render: (r) => <DataStatusPill status={r.risk.dataStatus} /> },
    { key: "act", label: "", render: (r) => <IconButton icon="eye" label={`View supplier ${r.name}`} onClick={() => go("supplier", r.id)} /> },
  ];

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All" }, { id: "red", label: "Act now" }, { id: "amber", label: "Watch" }, { id: "green", label: "OK" },
  ];

  return (
    <>
      <PageHeader title="Supplier risk" logo={plant && <CompanyMark name={plant.name} />} actions={<ModelSelect />}
        caption={program
          ? `${plant ? `${plant.name} · ` : ""}For ${modelLabel(program)}, built at ${program.oemPlant} (${num(program.dailyVehicles)} vehicles a day) · 14-day outlook · updated ${date(asOf)}`
          : `${plant ? `${plant.name} · ${plant.city} plant · ` : ""}All models · 14-day outlook · updated ${date(asOf)}`} />

      <div className="ft-stats">
        <StatCard label="Suppliers at Act now" value={count("red")} icon="bell" tone="accent" />
        <StatCard label="Suppliers at Watch" value={count("amber")} icon="pulse" />
        <StatCard label={program ? `Soonest ${program.model} line stop` : "Soonest line stop"} value={soonest == null ? "None" : days(soonest)} icon="truck" />
        <StatCard label={lineStoppersBelow ? `Parts below safe cover (${lineStoppersBelow} line stopper${lineStoppersBelow === 1 ? "" : "s"})` : "Parts below safe cover"}
          value={partsBelow} icon="chart" />
      </div>

      <Card title="Where the risk is">
        <RiskMap suppliers={rows} plant={plant} signals={signals} asOf={asOf} onOpen={(id) => go("supplier", id)} />
      </Card>

      <div className="ft-toolbar" role="group" aria-label="Filter suppliers">
        {filters.map((f) => <FilterChip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</FilterChip>)}
        <SearchField label="Search suppliers by name" placeholder="Search supplier" width={320} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <Empty title="No suppliers to show yet">Risk appears here once you invite suppliers and they accept.</Empty>
      ) : (
        <>
          <DataTable caption="Suppliers sorted by days to line stop" columns={columns} rows={shown} />
          {shown.length === 0 && <div className="ft-nodata">No suppliers match this filter.</div>}
        </>
      )}

      {rows.length > 0 && (
        <Card title="Next 12 weeks">
          <OutlookLegend />
          <OutlookGrid rows={shown.map((r) => ({ id: r.id, name: r.name, outlook: r.risk.outlook ?? [] }))} onOpen={(id) => go("supplier", id)} />
          <FormulaSource formula={OUTLOOK_FORMULA} data="Seasonal and announced signals (Signals page), route legs, and your stock cover of each supplier's critical parts." provenance="estimated" />
        </Card>
      )}

      <FormulaSource
        formula={`Score (0–100) = sum of driver points. Red (Act now) if a line stop is expected within 3 days or score ≥ 65. With a vehicle model selected, only suppliers and parts for that model count, and days to line stop come from that model's parts. Suppliers are sorted by days to line stop, then by the most critical part at risk, then by score. A part is below safe cover when its stock runs out before the next delivery arrives (supplier's delivery date, or today + expected transit rounded up to whole days when none is given). Delivery record: 12-week average OTIF against the contract target (${pct(DEFAULT_OTIF_TARGET, 0)} unless set): A at or above target, B up to 3 points below, C further below.`}
        data={`Signals (weather, roads, theft, ports), supplier transit history, your stock cover, the +${swing} demand test and weekly delivery records. Where a supplier has not connected data, the score uses public signals only.`}
        provenance="estimated"
      />
    </>
  );
}
