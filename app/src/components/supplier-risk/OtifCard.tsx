// Delivery performance (OTIF): 12-week sparkline, change, and the A/B/C delivery record.
import { Card, FormulaSource, GradePill, OtifDelta } from "../shared";
import { pct } from "../../lib/format";
import { otifSummary } from "../../lib/otif";
import type { Provenance } from "../../lib/types";
import { Sparkline } from "./Sparkline";

export function OtifCard({ trend, target, provenance }: { trend: number[]; target: number; provenance: Provenance }) {
  // Same comparison as the risk board and the score: last 4 weeks vs first 4 weeks.
  const record = otifSummary(trend, target);
  return (
    <Card title="Delivery performance (OTIF, 12 weeks)">
      {trend.length < 2 ? <p className="supplier-risk-note">Not enough weeks of delivery data yet.</p> : (
        <div className="supplier-risk-otif">
          <Sparkline values={trend} />
          <div>
            <div className="supplier-risk-otif-value ks-num">{pct(trend[trend.length - 1])}</div>
            {record && <div><OtifDelta change={record.change} long /></div>}
          </div>
          {record && (
            <div className="supplier-risk-grade">
              <GradePill grade={record.grade} />
              <span className="supplier-risk-note ks-num">12-week average {pct(record.average)} · target {pct(record.target, 0)}</span>
            </div>
          )}
        </div>
      )}
      <FormulaSource formula="Order lines delivered on time and in full ÷ all order lines, per week. Delivery record: 12-week average against the contract OTIF target; A at or above target, B up to 3 points below, C further below. Kept separate from the risk light, which looks forward." data="Delivery records shared by the supplier." provenance={provenance} />
    </Card>
  );
}
