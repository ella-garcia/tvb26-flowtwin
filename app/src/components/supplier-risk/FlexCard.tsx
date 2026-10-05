// Can the supplier absorb the contract demand swing? Result of the twin's surge run.
import { useApp } from "../../app/AppContext";
import { Card, FlexPill, FormulaSource, ProvenanceTag } from "../shared";
import { days, pct } from "../../lib/format";
import type { FlexResult } from "../../lib/types";

export function FlexCard({ flex: f }: { flex: FlexResult }) {
  const { db } = useApp();
  return (
    <Card title={`Can they absorb a +${pct(f.demandIncrease, 0)} demand change?`} actions={<ProvenanceTag provenance={f.provenance} />}>
      <div className="supplier-risk-flex">
        <div className="supplier-risk-flex-verdict">
          <span className="supplier-risk-flex-word">{f.canAbsorb ? "Yes" : "No"}</span>
          <FlexPill flex={f} />
        </div>
        <dl className="supplier-risk-facts">
          <dt>Service level under surge</dt><dd className="ks-num">{pct(f.serviceLevel, 0)}</dd>
          <dt>Days to recover</dt><dd className="ks-num">{f.daysToRecover == null ? "Not needed" : days(f.daysToRecover)}</dd>
          <dt>Headroom before the surge</dt><dd className="ks-num">{pct(f.headroom, 0)}</dd>
          <dt>Bottleneck</dt><dd>{f.bottleneck}</dd>
        </dl>
        <p className="supplier-risk-note">Contracts allow demand changes of ±{pct(db.settings().contractDemandSwing, 0)}, so this is tested for +{pct(f.demandIncrease, 0)}.</p>
        <FormulaSource formula="Twin run with demand raised by the contract swing; service level = units delivered on time ÷ units ordered."
          data="Supplier capacity, shifts and material supply in the twin." provenance={f.provenance} />
      </div>
    </Card>
  );
}
