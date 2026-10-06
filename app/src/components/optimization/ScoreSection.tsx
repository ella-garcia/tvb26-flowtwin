// Optimization score with an Operational / Industry view toggle (state shared via AppContext).
import { useApp } from "../../app/AppContext";
import { FormulaSource } from "../shared";
import { FilterChip } from "../../keystone";
import { CAP_DAYS, CAP_SCORE, CONCENTRATION, EXECUTION, NEAR_CAPACITY, industryScore, type SupplierContext } from "../../lib/industry";
import { pct } from "../../lib/format";
import { score, type Choice, type ScenarioRow } from "../../lib/scenarios";
import { ScoreGauge } from "./Charts";
import "./optimization.css";

const OPERATIONAL_FORMULA = "Score = 100 × (1 − (2 × High supplier-weeks + Watch supplier-weeks) ÷ (2 × at-risk suppliers × weeks)), over the chosen horizon, for the suppliers that have a risk in it; 100 means all their weeks are OK. Weekly levels come from the 12-week outlook; with optimizations, from the engine's result for the actions each supplier adopts.";
const INDUSTRY_FORMULA = `Industry view, the way an automaker or a bank would read it: (1) every supplier counts, not only those with a known risk; (2) structural weaknesses set a floor on each week: 1–2 flags = 0.5 points, 3 or more = 1 point (Watch). Flags: single-source critical part, ${pct(1 - NEAR_CAPACITY, 0)} or more of capacity used, more than ${pct(CONCENTRATION, 0)} of the supplier's sales to you, imported inputs (border, customs or port), no shared data, delivery grade C, cannot absorb +15% demand; (3) each adopted optimization works with ${pct(EXECUTION, 0)} probability, so "with optimizations" is the expected score and the range runs from none working to all working; (4) weakest link: while any week still expects ${CAP_DAYS} days or more of line stop, the score is capped at ${CAP_SCORE} (Poor). Score = 100 × (1 − points ÷ (2 × suppliers × weeks)).`;

export function ScoreSection({ rows, choice, weeks, ctx }: { rows: ScenarioRow[]; choice: Choice; weeks: number; ctx: Map<string, SupplierContext> }) {
  const { scenario, setScenario } = useApp();
  const industry = scenario.view === "industry";
  const ind = industry ? industryScore(rows, choice, weeks, ctx) : null;
  return (
    <div className="opt-score-section">
      <div className="ft-toolbar" role="group" aria-label="Score view">
        <span className="opt-label">View</span>
        <FilterChip pressed={!industry} onClick={() => setScenario({ view: "operational" })}>Operational</FilterChip>
        <FilterChip pressed={industry} onClick={() => setScenario({ view: "industry" })}>Industry view</FilterChip>
      </div>
      {!ind ? (
        <>
          <ScoreGauge before={score(rows, {}, weeks)} after={score(rows, choice, weeks)} />
          <FormulaSource formula={OPERATIONAL_FORMULA} data="Seasonal and announced signals, route legs, your stock cover, and each supplier's recommended optimizations." provenance="estimated" />
        </>
      ) : (
        <>
          <ScoreGauge before={ind.before} after={ind.after} />
          <ul className="opt-industry-notes">
            <li>With optimizations, expected at {pct(EXECUTION, 0)} execution: <b className="ks-num">{ind.after}</b>; range <b className="ks-num">{ind.range.low}</b> (none works) to <b className="ks-num">{ind.range.high}</b> (all work).</li>
            {ind.beforeCapped && <li><b>No action is capped at {CAP_SCORE}</b>: a line stop is still expected at {ind.beforeCapBy.join(", ")}.</li>}
            {ind.afterCapped
              ? <li><b>With optimizations is capped at {CAP_SCORE}</b>: a line stop is still expected at {ind.afterCapBy.join(", ")} if the actions fall short.</li>
              : ind.beforeCapped && <li>With the chosen optimizations the expected line stop falls below {CAP_DAYS} days a week, so the cap lifts.</li>}
            <li>All {ind.suppliers} suppliers count; {ind.flagged.length} have structural weaknesses.</li>
          </ul>
          {ind.flagged.length > 0 && (
            <div className="opt-scroll">
              <table className="opt-table opt-table-wide opt-table-flags">
                <thead><tr><th scope="col">Supplier</th><th scope="col">Structural weaknesses</th><th scope="col">Floor per week</th></tr></thead>
                <tbody>
                  {ind.flagged.map((f) => (
                    <tr key={f.id}>
                      <th scope="row">{f.name}</th>
                      <td className="opt-flags">{f.flags.join(" · ")}</td>
                      <td>{f.flags.length >= 3 ? "Watch (1)" : "0.5"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <FormulaSource formula={INDUSTRY_FORMULA} data="Engine results per supplier and action, your parts list, each supplier's share of sales to you, delivery history, the +15% demand test, data status and route legs." provenance="estimated" />
        </>
      )}
    </div>
  );
}
