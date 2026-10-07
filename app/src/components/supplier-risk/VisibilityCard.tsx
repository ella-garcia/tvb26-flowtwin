// Visibility index for one supplier: the 0-100 number and its three parts (sensing, learning, coordinating) as bars.
// Shown to the key customer and, unchanged, to the supplier ("what your customer sees").
import { Card, FormulaSource, ProvenanceTag } from "../shared";
import { num } from "../../lib/format";
import { visibilityIndex, VISIBILITY_CITATION, VISIBILITY_FORMULA } from "../../lib/visibility";
import type { Alert, Part, RiskAssessment } from "../../lib/types";
import "./visibility.css";

const SYMBOL = { High: "▲", Medium: "◆", Low: "▼" } as const;

export function VisibilityCard({ risk, parts, alerts }: { risk: RiskAssessment; parts: Part[]; alerts: Alert[] }) {
  const v = visibilityIndex(risk, parts, alerts);
  return (
    <Card title="Visibility" actions={<ProvenanceTag provenance="estimated" />}>
      <div className="vis-head">
        <span className="vis-index ks-num">{num(v.index)}<small> of 100</small></span>
        <span className={`vis-word vis-word-${v.word.toLowerCase()}`}><span aria-hidden="true">{SYMBOL[v.word]}</span> {v.word}</span>
      </div>
      <ul className="vis-bars">
        {v.parts.map((p) => (
          <li key={p.key}>
            <div className="vis-label"><b>{p.label}</b><small>weight {num(p.weight * 100)}%</small></div>
            <div className="vis-track" role="img" aria-label={`${p.label}: ${num(p.value * 100)} out of 100`}><i style={{ width: `${p.value * 100}%` }} /></div>
            <span className="vis-val ks-num">{num(p.value * 100)}</span>
            <ul className="vis-why">{p.why.map((w) => <li key={w}>{w}</li>)}</ul>
          </li>
        ))}
      </ul>
      <p className="supplier-risk-note">Bars are drawn on a 0 to 100 scale. High is 70 or more, Medium 40 to 69, Low below 40. It measures how well the shared data lets both sides see, learn from and answer disruptions. It does not change the risk light.</p>
      <FormulaSource formula={`${VISIBILITY_FORMULA} ${VISIBILITY_CITATION}`}
        data="Data status, this supplier's parts (units in transit, delivery dates), route legs, weeks of delivery history and alert answers, all already loaded. No supplier costs." provenance="estimated" />
    </Card>
  );
}
