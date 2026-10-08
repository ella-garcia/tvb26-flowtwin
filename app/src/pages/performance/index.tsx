// Tier 1 Performance view: how suppliers have been doing (receipts, track record) and where things stand today.
// The risk board looks 14 days ahead; this page looks back over a period. Model: lib/performance.ts. No money here.
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { Card, CompanyMark, FormulaSource, ModelSelect, PageHeader, ScopedError } from "../../components/shared";
import { FilterChip, StatCard, StatusPill, type IconName } from "../../keystone";
import { date } from "../../lib/format";
import { modelLabel } from "../../lib/programs";
import { buildPerformance, evenTop, type KpiTile, type PeriodDays } from "../../lib/performance";
import { usePerformanceExtra } from "../../lib/performanceData";
import { summarize, useTrack } from "../../lib/trackData";
import { useScoped } from "../../lib/useScoped";
import { DeliveriesChart, DisruptionDonut, MiniLegend, SupplierMini, TrendChart } from "./Charts";
import "./performance.css";

const PERIODS: PeriodDays[] = [30, 90, 180];
const ICON: Record<KpiTile["id"], IconName> = {
  "act-now": "bell", "soonest-stop": "truck", "below-cover": "cube", otif: "check", "days-late": "pulse", "hit-rate": "chart",
};

export default function PerformancePage() {
  const { db, go, mode, toggles, programId } = useApp();
  const [period, setPeriod] = useState<PeriodDays>(180);
  const customerId = toggles.companyId;
  const base = useScoped(() => ({ parts: db.parts(), risks: db.risks(), alerts: db.alerts(), signals: db.signals(), companies: db.companies() }), [db]);
  const extra = usePerformanceExtra(mode, db.viewer, db.asOf);
  // An unknown or stale model id means all models, as in the model selector and on the risk board.
  const program = db.programs().find((g) => g.id === programId);
  const activeProgram = program ? program.id : "all";
  const track = useTrack(mode, db.viewer, { customerId });

  // Cheap to build (a few hundred rows), so it is recomputed each render rather than memoized.
  const model = !base.ok || extra.status !== "ready" ? null : buildPerformance({
    asOf: db.asOf, customerId, ...base.data, receipts: extra.data.receipts, history: extra.data.history,
    track: track.status === "ready" ? summarize(track.data.entries, db.asOf) : null, sample: extra.data.sample,
  }, { periodDays: period, programId: activeProgram });

  const plant = db.company(customerId);
  const head = (
    <PageHeader title="Performance" logo={plant && <CompanyMark name={plant.name} />}
      actions={<>{model?.sample && <StatusPill tone="warning">Sample data</StatusPill>}<ModelSelect /></>}
      caption={model
        ? `${plant ? `${plant.name} · ` : ""}${program ? `${modelLabel(program)} only · ` : "All models · "}Deliveries from ${date(model.period.from)} to ${date(model.period.to)} · risk as of ${date(db.asOf)}`
        : "How your suppliers have been delivering, and where things stand today"} />
  );
  if (!base.ok) return <ScopedError title="Performance" error={base.error} />;
  if (extra.status === "error") return <>{head}<p className="perf-note">Delivery data could not be loaded ({extra.error}).</p></>;
  if (!model) return <>{head}<p className="perf-note">Loading deliveries and daily snapshots…</p></>;

  const yMax = evenTop(Math.max(4, ...model.suppliers.flatMap((s) => s.parts.flatMap((p) => [p.coverDays, p.transitDays ?? 0]))));
  // Tile labels say which period and which deliveries each figure covers.
  const LABEL: Partial<Record<KpiTile["id"], string>> = {
    otif: `On time in full (${period} days)`,
    "days-late": "Avg days late (late deliveries)",
    "hit-rate": "Alert hit rate (90 days)",
  };
  const soonest = model.suppliers.find((p) => p.daysToLineStop != null);
  const sub = (k: KpiTile) => (k.id === "soonest-stop" && soonest
    ? <span className="perf-kpi-sub" title={soonest.name}>{soonest.name}</span> : null);
  return (
    <>
      {head}
      <div className="ft-toolbar" role="group" aria-label="Delivery period">
        {PERIODS.map((d) => <FilterChip key={d} pressed={period === d} onClick={() => setPeriod(d)}>{`Last ${d} days`}</FilterChip>)}
      </div>

      <div className="perf-kpis">
        {model.kpis.map((k) => (
          <StatCard key={k.id} label={LABEL[k.id] ?? k.label} value={<>{k.display}{sub(k)}</>} icon={ICON[k.id]} tone={k.id === "act-now" ? "accent" : "default"}
            delta={k.delta && k.delta.value !== 0 ? { value: k.delta.amount, direction: k.delta.value > 0 ? "up" : "down", good: k.delta.improved, caption: ` vs ${k.delta.vs}` } : undefined} />
        ))}
      </div>
      <FormulaSource
        formula={model.kpis.map((k) => `${k.label}: ${k.formula}`).join(" ")}
        data={model.kpis.map((k) => `${k.label}: ${k.data}`).join(" ")}
        provenance="measured" />

      <div className="perf-grid-main">
        <Card title="Suppliers by days to line stop" className="perf-suppliers">
          <p className="perf-note">Top {model.suppliers.length}, in risk board order. Up to three parts per supplier, most critical first. Select a supplier to see its detail.</p>
          <MiniLegend />
          {model.suppliers.length === 0
            ? <p className="perf-note">No supplier risk to show yet.</p>
            : <ol className="perf-minis">{model.suppliers.map((p) => <SupplierMini key={p.supplierId} panel={p} yMax={yMax} onOpen={() => go("supplier", p.supplierId)} />)}</ol>}
          <FormulaSource formula="Ranked by days to line stop (none last), then the most critical part that runs out before its next delivery, then score. Up to three parts per supplier, most critical first. Grade: 12-week on-time-in-full average against the contract target."
            data="Your stock per part and its daily usage, next delivery dates or expected transit, and weekly delivery records." provenance="estimated" />
        </Card>

        <div className="perf-side">
          <Card title="Active disruptions">
            <DisruptionDonut slices={model.disruptions.slices} affected={model.disruptions.affected} />
            <p className="perf-note">A supplier hit by two types counts in both, so the types can add up to more than the suppliers affected.</p>
            <FormulaSource formula="For each disruption type, the number of your suppliers whose risk score includes at least one active signal of that type."
              data="Risk drivers from the 14-day projection; signals an admin disabled are left out." provenance="estimated" />
          </Card>
          <Card title="Received vs ordered">
            <DeliveriesChart months={model.deliveries} />
            <FormulaSource formula="Per month of promised date: ordered and received quantities converted to days of usage (quantity ÷ the part's daily usage) so parts in pieces and kg add up. Red: the shortfall. OTIF: lines on time and in full ÷ lines due. Lines without a known part count in OTIF only."
              data="Your goods receipts (promised and received date, ordered and received quantity) and each part's daily usage." provenance="measured" />
          </Card>
        </div>
      </div>

      <Card title="Supplier risk over the last 31 days">
        <TrendChart points={model.trend} />
        <FormulaSource formula="Line: average risk score of your suppliers each day (0 to 100). ▲ marks the highest day, ▼ the lowest. Bars below: suppliers at Act now that day. Days without a snapshot are left blank."
          data="Daily risk snapshots kept by the hourly run (risk_history)." provenance="estimated" />
      </Card>
    </>
  );
}
