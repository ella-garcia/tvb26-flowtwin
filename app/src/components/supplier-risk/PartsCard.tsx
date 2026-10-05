// Parts from this supplier with stock along the pipeline, ranked by line-stop risk.
import { useApp } from "../../app/AppContext";
import { Card, CritPill, ProvenanceTag } from "../shared";
import { DataTable, StatusPill, type Column } from "../../keystone";
import { date, mxn, num, rowNo } from "../../lib/format";
import { programsOf } from "../../lib/programs";
import { CRIT_RANK, partStock } from "../../lib/stock";
import type { Part, RiskAssessment, VehicleProgram } from "../../lib/types";

interface Props { parts: Part[]; programs: VehicleProgram[]; risk: RiskAssessment; supplierId: string; audience: "customer" | "supplier" }

export function PartsCard({ parts, programs, risk, supplierId, audience }: Props) {
  const { db, go } = useApp();
  const sorted = [...parts].sort((a, b) => CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality] || a.daysOfCover - b.daysOfCover);
  const cols: Column<Part>[] = [
    { key: "no", label: "No", render: (_p, i) => rowNo(i) },
    { key: "number", label: "Part number", render: (p) => <span className="supplier-risk-part-name">{p.number}</span> },
    { key: "name", label: "Name" },
    { key: "criticality", label: "Criticality", render: (p) => <CritPill c={p.criticality} /> },
    { key: "models", label: "Models", render: (p) => {
      const ms = programsOf([p], programs);
      return ms.length ? ms.map((g) => g.model).join(", ") : <span className="supplier-risk-muted">Not mapped</span>;
    } },
    { key: "singleSource", label: "Single source", render: (p) => (p.singleSource ? "Yes" : "No") },
    { key: "dailyUsage", label: "Daily usage", numeric: true, align: "right", render: (p) => num(p.dailyUsage) },
    { key: "onHand", label: "On hand", numeric: true, align: "right", render: (p) => num(p.onHand) },
    { key: "daysOfCover", label: "Days of cover", numeric: true, align: "right", render: (p) => num(p.daysOfCover, 1) },
    { key: "inTransit", label: "On the road", numeric: true, align: "right", render: (p) => p.inTransit == null ? <span className="supplier-risk-muted">Unknown</span> : num(p.inTransit) },
    { key: "supplierFg", label: "At supplier", numeric: true, align: "right", render: (p) => p.supplierFgOnHand == null ? <span className="supplier-risk-muted">Not shared</span> : num(p.supplierFgOnHand) },
    { key: "next", label: "Next delivery", render: (p) => {
      const st = partStock(p, risk, db.asOf);
      if (!st.nextDeliveryDate) return <span className="supplier-risk-muted">No estimate</span>;
      return (
        <span className="supplier-risk-next">
          <span className="ks-num">{date(st.nextDeliveryDate)}</span>
          {st.status === "short" && <StatusPill tone="danger">Runs out first</StatusPill>}
          {st.status === "tight" && <StatusPill tone="warning">Tight</StatusPill>}
          {st.nextDeliveryEstimated && <ProvenanceTag provenance="estimated" />}
        </span>
      );
    } },
    { key: "unitCostMxn", label: "Unit cost", numeric: true, align: "right", render: (p) => mxn(p.unitCostMxn) },
  ];

  return (
    <Card title="Parts">
      {sorted.length === 0 ? <p className="supplier-risk-note">No parts are shared for this supplier yet.</p> : (
        <DataTable<Part> caption="Parts from this supplier" columns={cols} rows={sorted} />
      )}
      <p className="supplier-risk-note">Ranked by line-stop risk, not by value. A MX$2 clip can stop a line.
        {audience === "customer" && <> <button type="button" className="ft-linkbtn" onClick={() => go("parts", supplierId)}>See these parts on Parts &amp; stock</button></>}</p>
    </Card>
  );
}
