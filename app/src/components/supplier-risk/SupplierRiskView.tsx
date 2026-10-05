// Supplier risk detail, shared by the key customer (audience "customer", pages/supplier) and the supplier's own
// "My risk" page (audience "supplier", pages/my-risk: "this is exactly what your customer sees").
import { useApp } from "../../app/AppContext";
import { Card, DataStatusPill, Empty, FormulaSource, ProvenanceTag, RiskLight, ScopedError } from "../shared";
import { Icon } from "../../keystone";
import { date, days, num } from "../../lib/format";
import { DEFAULT_OTIF_TARGET } from "../../lib/otif";
import { scoped, useScoped } from "../../lib/useScoped";
import { segmentLabel } from "../../packs";
import type { ChainPosition, Part, RiskAssessment } from "../../lib/types";
import { DriversCard } from "./DriversCard";
import { FlexCard } from "./FlexCard";
import { OtifCard } from "./OtifCard";
import { PartsCard } from "./PartsCard";
import { ProjectionChart, ProjectionLegend } from "./ProjectionChart";
import { RelatedAlerts } from "./RelatedAlerts";
import { RouteCard } from "./RouteCard";
import "./supplier-risk.css";

export interface SupplierRiskViewProps { customerId: string; supplierId: string; audience: "customer" | "supplier" }

/** The part that stops the line first: lowest engine stop day; without per-part stop days, the lowest-cover line stopper. */
function firstToStop(r: RiskAssessment, parts: Part[]): Part | undefined {
  const stops = r.partStopDays ?? {};
  const withStop = parts.filter((p) => stops[p.id] != null).sort((a, b) => stops[a.id] - stops[b.id]);
  if (withStop.length) return withStop[0];
  const byCover = [...parts].sort((a, b) => a.daysOfCover - b.daysOfCover);
  return byCover.find((p) => p.criticality === "line-stopper") ?? byCover[0];
}

function headline(r: RiskAssessment, parts: Part[]): { text: string; tone: "danger" | "ok" } {
  if (r.daysToLineStop == null) return { text: "No line stop expected in the next 14 days", tone: "ok" };
  const worst = firstToStop(r, parts);
  const d = r.daysToLineStop;
  const when = d <= 0 ? "today" : `in ${days(d)}`;
  return { text: worst ? `If nothing changes, your line runs out of ${worst.number} ${when}` : `If nothing changes, your line may stop ${when}`, tone: "danger" };
}

export function SupplierRiskView({ customerId, supplierId, audience }: SupplierRiskViewProps) {
  const { db, pack, go } = useApp();
  const read = useScoped(() => {
    const s = db.company(supplierId);
    // The relationship gives the chain position and OTIF target; without access, keep the defaults.
    const rel = scoped(() => audience === "customer"
      ? db.suppliersOf(customerId).find((x) => x.company.id === supplierId)
      : db.customersOf(supplierId).find((x) => x.customerId === customerId));
    const found = rel.ok ? rel.data : undefined;
    return {
      risk: db.risk(customerId, supplierId),
      parts: db.parts().filter((p) => p.supplierId === supplierId && p.customerId === customerId),
      alerts: db.alerts().filter((a) => a.supplierId === supplierId && a.customerId === customerId),
      signals: db.signals(),
      programs: db.programs(),
      supplierName: s?.name ?? supplierId,
      place: s ? `${s.city}, ${s.state}` : "",
      sizeBand: s?.sizeBand ?? "medium",
      customerName: db.company(customerId)?.name ?? "your customer",
      chain: (found?.chainPosition ?? "sub") as ChainPosition,
      otifTarget: found?.requirements.otifTarget ?? DEFAULT_OTIF_TARGET,
    };
  }, [db, customerId, supplierId, audience]);

  if (!read.ok) return <ScopedError error={read.error} />;
  const { risk, parts, alerts, signals, programs, supplierName, place, sizeBand, customerName, chain, otifTarget } = read.data;
  if (!risk) {
    return <Empty title="No risk assessment yet" action={audience === "customer" ? <button type="button" className="ft-linkbtn" onClick={() => go("risk")}>Back to the risk board</button> : undefined}>
      {supplierName ? `There is no risk assessment for ${supplierName} yet.` : "There is no risk assessment for this supplier yet."}
    </Empty>;
  }

  const prov = risk.dataStatus === "connected" ? "measured" : "estimated";
  const head = headline(risk, parts);
  const privacy = audience === "supplier"
    ? <>This is exactly what <strong>{customerName}</strong> sees: risk light, drivers, parts and stock, flex test, delivery performance. Never shared: costs, prices and margins.</>
    : <>Shared with <strong>{customerName}</strong>: risk light, drivers, parts and stock, flex test, delivery performance. <strong>Never shared:</strong> costs, prices and margins.</>;

  return (
    <div className="supplier-risk-stack">
      <div className="supplier-risk-head">
        <div className="supplier-risk-head-top">
          <h1 className="ft-title">{supplierName}</h1>
          <RiskLight level={risk.level} />
        </div>
        <div className="supplier-risk-meta">
          {place && <span>{place}</span>}
          <span>{segmentLabel(pack, chain, sizeBand)}</span>
          <span className="supplier-risk-score ks-num">Score {num(risk.score)} of 100</span>
          <DataStatusPill status={risk.dataStatus} />
          <span>Updated {date(risk.updatedAt)}</span>
        </div>
        <p className={`supplier-risk-headline supplier-risk-headline-${head.tone}`}>{head.text}</p>
      </div>

      <DriversCard risk={risk} signals={signals} />

      <Card title="Twin projection, next 14 days" actions={<ProvenanceTag provenance={prov} />}>
        {risk.projection.length > 1 ? (
          <>
            <ProjectionChart proj={risk.projection} normal={risk.normalTransitDays} />
            <ProjectionLegend />
          </>
        ) : <p className="supplier-risk-note">No projection is available yet.</p>}
        <p className="supplier-risk-note ks-num">Normal transit {num(risk.normalTransitDays, 1)} days · expected {num(risk.expectedTransitDays, 1)} days · worst case {num(risk.worstCaseTransitDays, 1)} days · lowest cover {num(risk.minCoverDays, 1)} days</p>
        <FormulaSource
          formula="Monte Carlo of transit time with the active signals applied; line stop risk starts on the first day cover is below expected transit (P50)."
          data={`Active signals on the lane, normal transit of ${num(risk.normalTransitDays, 1)} days, and ${customerName}'s stock and daily usage.`}
          provenance={prov} />
      </Card>

      {risk.legs && risk.legs.length > 1 && <RouteCard legs={risk.legs} provenance={prov} />}

      <FlexCard flex={risk.flex} />
      <PartsCard parts={parts} programs={programs} risk={risk} supplierId={supplierId} audience={audience} />
      <OtifCard trend={risk.otifTrend} target={otifTarget} provenance={prov} />
      {audience === "customer" && <RelatedAlerts alerts={alerts} />}

      <Card>
        <div className="supplier-risk-privacy"><Icon name="lock" /><p>{privacy}</p></div>
      </Card>
    </div>
  );
}
