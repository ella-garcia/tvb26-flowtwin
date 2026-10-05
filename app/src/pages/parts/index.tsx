// Tier 1 parts & stock: one row per part number, with stock along the pipeline
// (here, on the road, at the supplier) against the next delivery. Reads via useApp().db only.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { CompanyMark, Empty, FormulaSource, NotShared, PageHeader, ProvenanceTag } from "../../components/shared";
import { DataTable, FilterChip, SearchField, StatCard, StatusPill, type Column } from "../../keystone";
import { AccessDeniedError } from "../../lib/dataLayer";
import { date, num, rowNo } from "../../lib/format";
import { CRIT_RANK, partStock, type PartStock, type StockStatus } from "../../lib/stock";
import type { Part } from "../../lib/types";
import "./parts.css";

interface Row extends PartStock { id: string; supplierName: string }
type StatusFilter = "all" | StockStatus;
type CritFilter = "all" | Part["criticality"];

const STATUS_ORDER: Record<StockStatus, number> = { short: 0, tight: 1, ok: 2 };
const days = (n: number) => `${num(n, n % 1 ? 1 : 0)} ${n === 1 ? "day" : "days"}`;

function StatusCell({ s }: { s: StockStatus }) {
  if (s === "short") return <StatusPill tone="danger">Runs out first</StatusPill>;
  if (s === "tight") return <StatusPill tone="warning">Tight</StatusPill>;
  return <StatusPill tone="success">OK</StatusPill>;
}

function CritPill({ c }: { c: Part["criticality"] }) {
  if (c === "line-stopper") return <StatusPill tone="danger">Line stopper</StatusPill>;
  if (c === "high") return <StatusPill tone="warning">High</StatusPill>;
  return <StatusPill tone="neutral">Normal</StatusPill>;
}

export default function PartsPage() {
  const { db, go, route, toggles } = useApp();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [crit, setCrit] = useState<CritFilter>("all");
  const [supplier, setSupplier] = useState<string>(route.sub ?? "all");
  const [query, setQuery] = useState("");
  useEffect(() => { setSupplier(route.sub ?? "all"); }, [route.sub]);

  const loaded = useMemo(() => {
    try {
      const customerId = toggles.companyId;
      const risks = new Map(db.risks().filter((r) => r.customerId === customerId).map((r) => [r.supplierId, r]));
      const rows: Row[] = db.parts().filter((p) => p.customerId === customerId).map((p) => ({
        ...partStock(p, risks.get(p.supplierId), db.asOf),
        id: p.id,
        supplierName: db.company(p.supplierId)?.name ?? p.supplierId,
      }));
      rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || CRIT_RANK[a.part.criticality] - CRIT_RANK[b.part.criticality]
        || a.part.daysOfCover - b.part.daysOfCover);
      return { rows, plant: db.company(customerId), error: null as string | null };
    } catch (e) {
      if (e instanceof AccessDeniedError) return { rows: [] as Row[], plant: undefined, error: e.message };
      throw e;
    }
  }, [db, toggles.companyId]);

  if (loaded.error) return <><PageHeader title="Parts & stock" /><NotShared message={loaded.error} /></>;
  const { rows, plant } = loaded;

  const suppliers = [...new Map(rows.map((r) => [r.part.supplierId, r.supplierName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (status === "all" || r.status === status)
    && (crit === "all" || r.part.criticality === crit)
    && (supplier === "all" || r.part.supplierId === supplier)
    && (!q || r.part.number.toLowerCase().includes(q) || r.part.name.toLowerCase().includes(q)));

  const short = rows.filter((r) => r.status === "short");
  const shortStoppers = short.filter((r) => r.part.criticality === "line-stopper").length;
  const lowest = rows.length ? Math.min(...rows.map((r) => r.part.daysOfCover)) : null;

  const columns: Column<Row>[] = [
    { key: "no", label: "No", render: (_r, i) => rowNo(i) },
    { key: "part", label: "Part", render: (r) => <span className="parts-name"><b className="ks-num">{r.part.number}</b><small>{r.part.name}</small></span> },
    { key: "supplier", label: "Supplier", render: (r) => (
      <button type="button" className="ft-linkbtn parts-supplier" onClick={() => go("supplier", r.part.supplierId)}>{r.supplierName}</button>
    ) },
    { key: "crit", label: "Criticality", render: (r) => <CritPill c={r.part.criticality} /> },
    { key: "here", label: "Stock here", numeric: true, align: "right", render: (r) => (
      <span className="parts-stack"><b>{days(r.part.daysOfCover)}</b><small>{num(r.part.onHand)} units</small></span>
    ) },
    { key: "road", label: "On the road", numeric: true, align: "right", render: (r) => r.part.inTransit == null
      ? <span className="parts-muted">Unknown</span>
      : <span className="parts-stack"><b>{num(r.part.inTransit)}</b><small>units</small></span> },
    { key: "supplierStock", label: "At supplier", numeric: true, align: "right", render: (r) => r.supplierCoverDays == null
      ? <span className="parts-muted">Not shared</span>
      : <span className="parts-stack"><b>{days(Math.round(r.supplierCoverDays * 10) / 10)}</b><small>{num(r.part.supplierFgOnHand!)} units</small></span> },
    { key: "pipeline", label: "Pipeline cover", numeric: true, align: "right", render: (r) => days(Math.round(r.pipelineCoverDays * 10) / 10) },
    { key: "runsOut", label: "Stock here runs out", render: (r) => <span className="ks-num">{date(r.runsOutDate)}</span> },
    { key: "next", label: "Next delivery", render: (r) => r.nextDeliveryDate == null ? <span className="parts-muted">No estimate</span> : (
      <span className="parts-next"><span className="ks-num">{date(r.nextDeliveryDate)}</span>{r.nextDeliveryEstimated && <ProvenanceTag provenance="estimated" />}</span>
    ) },
    { key: "status", label: "Status", render: (r) => <StatusCell s={r.status} /> },
  ];

  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" }, { id: "short", label: "Runs out first" }, { id: "tight", label: "Tight" }, { id: "ok", label: "OK" },
  ];

  return (
    <>
      <PageHeader title="Parts & stock" logo={plant && <CompanyMark name={plant.name} />}
        caption={`${plant ? `${plant.name} · ${plant.city} plant · ` : ""}${rows.length} part numbers from ${suppliers.length} suppliers · updated ${date(db.asOf)}`} />

      <div className="parts-stats">
        <StatCard label="Run out before the next delivery" value={short.length} icon="bell" tone="accent" />
        <StatCard label="Line stoppers among them" value={shortStoppers} icon="truck" />
        <StatCard label="Lowest cover here" value={lowest == null ? "None" : days(lowest)} icon="chart" />
        <StatCard label="Part numbers tracked" value={rows.length} icon="cube" />
      </div>

      <div className="parts-toolbar" role="group" aria-label="Filter parts">
        {statusFilters.map((f) => <FilterChip key={f.id} pressed={status === f.id} onClick={() => setStatus(f.id)}>{f.label}</FilterChip>)}
        <label className="parts-select">Supplier
          <select value={supplier} onChange={(e) => go("parts", e.target.value === "all" ? undefined : e.target.value)}>
            <option value="all">All suppliers</option>
            {suppliers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <label className="parts-select">Criticality
          <select value={crit} onChange={(e) => setCrit(e.target.value as CritFilter)}>
            <option value="all">All</option>
            <option value="line-stopper">Line stopper</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </select>
        </label>
        <SearchField label="Search parts by number or name" placeholder="Search part" width={260} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <Empty title="No parts yet">Upload your parts list and stock on the Data page to see them here.</Empty>
      ) : (
        <>
          <DataTable caption="Parts sorted by status, criticality and days of cover" columns={columns} rows={shown} />
          {shown.length === 0 && <div className="parts-nodata">No parts match these filters.</div>}
        </>
      )}

      <FormulaSource
        formula="Days of cover = stock here ÷ daily usage. Pipeline cover = (stock here + on the road) ÷ daily usage. Runs out first: days of cover are less than the days until the next delivery arrives. Tight: less than one day of margin. Next delivery = the supplier's confirmed date; when there is none, today + expected transit for that supplier, rounded up to whole days (estimated)."
        data="Your stock and daily usage (stock upload), shipments on the road (ASNs or the stock upload), the supplier's finished goods when it shares its data, and the supplier's expected transit from the risk engine."
        provenance="estimated"
      />
    </>
  );
}
