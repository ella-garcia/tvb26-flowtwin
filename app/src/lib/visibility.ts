// Supply-chain visibility index (0-100) for one supplier, from data FlowTwin already holds. Pure; no engine call.
// Basis: Sadiq et al. (2026), Technovation 157, 103653. Visibility is a second-order construct with three parts,
// loadings sensing 0.86, learning 0.81, coordinating 0.38. We normalise the loadings into weights. The three
// proxies below are FlowTwin's own operationalisation, not the paper's survey items, and are not validated.
import type { Alert, Part, RiskAssessment } from "./types";

export const VISIBILITY_WEIGHTS = { sensing: 0.42, learning: 0.39, coordinating: 0.19 } as const;
export const VISIBILITY_LOADINGS = { sensing: 0.86, learning: 0.81, coordinating: 0.38 } as const;

export const VISIBILITY_FORMULA =
  "Index = 100 × (0.42 × sensing + 0.39 × learning + 0.19 × coordinating), each part from 0 to 1. " +
  "Sensing = average of: data status (connected 1, invited 0.4, public data only 0.2), share of this supplier's parts with units in transit and a delivery date, route known (several legs or connected 1, else 0.5). " +
  "Learning = weeks of delivery history ÷ 12 (at most 1) × (1 if connected, else 0.5). " +
  "Coordinating = share of this supplier's alerts that the supplier answered (0.5 when there are no alerts yet). " +
  "Weights are the paper's loadings (0.86, 0.81, 0.38) divided by their sum and rounded.";

export const VISIBILITY_CITATION =
  "Sadiq et al. (2026), Technovation 157, 103653: visibility loads on sensing 0.86, learning 0.81, coordinating 0.38.";

export interface VisibilityPart { key: "sensing" | "learning" | "coordinating"; label: string; value: number; weight: number; why: string[] }
export interface Visibility {
  index: number;                       // 0..100
  sensing: number; learning: number; coordinating: number; // each 0..1
  parts: VisibilityPart[];
  word: "High" | "Medium" | "Low";
}

const STATUS_SCORE: Record<RiskAssessment["dataStatus"], number> = { connected: 1, invited: 0.4, "public-only": 0.2 };
const STATUS_WORD: Record<RiskAssessment["dataStatus"], string> = { connected: "connected", invited: "invited", "public-only": "public data only" };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** High at 70 or more, Medium 40 to 69, Low below 40. Shown with the number, never as colour alone. */
export const visibilityWord = (index: number): Visibility["word"] => (index >= 70 ? "High" : index >= 40 ? "Medium" : "Low");

/** `parts` and `alerts` are filtered to this supplier here, so callers may pass the whole customer's lists. */
export function visibilityIndex(risk: RiskAssessment, parts: Part[], alerts: Alert[]): Visibility {
  const mine = parts.filter((p) => p.supplierId === risk.supplierId && p.customerId === risk.customerId);
  const theirs = alerts.filter((a) => a.supplierId === risk.supplierId && a.customerId === risk.customerId);
  const connected = risk.dataStatus === "connected";

  const status = STATUS_SCORE[risk.dataStatus] ?? 0.2;
  const tracked = mine.filter((p) => p.inTransit != null && !!p.nextDeliveryDate).length;
  const trackedShare = mine.length ? tracked / mine.length : 0;
  const routeKnown = (risk.legs?.length ?? 0) > 1 || connected ? 1 : 0.5;
  const sensing = clamp01((status + trackedShare + routeKnown) / 3);

  const weeks = risk.otifTrend?.length ?? 0;
  const learning = clamp01(Math.min(1, weeks / 12) * (connected ? 1 : 0.5));

  const answered = theirs.filter((a) => a.supplierResponse).length;
  const coordinating = theirs.length ? clamp01(answered / theirs.length) : 0.5;

  const w = VISIBILITY_WEIGHTS;
  const index = Math.round(100 * (w.sensing * sensing + w.learning * learning + w.coordinating * coordinating));
  const pctText = (v: number) => `${Math.round(v * 100)}%`;
  return {
    index, sensing, learning, coordinating, word: visibilityWord(index),
    parts: [
      { key: "sensing", label: "Sensing", value: sensing, weight: w.sensing, why: [
        `Data ${STATUS_WORD[risk.dataStatus] ?? "public data only"} (${STATUS_SCORE[risk.dataStatus] ?? 0.2})`,
        `${tracked} of ${mine.length} parts with units in transit and a delivery date`,
        routeKnown === 1 ? "Route known" : "Route estimated from one leg"] },
      { key: "learning", label: "Learning", value: learning, weight: w.learning, why: [
        `${weeks} of 12 weeks of delivery history`, connected ? "Supplier data connected" : "Supplier data not connected (counts half)"] },
      { key: "coordinating", label: "Coordinating", value: coordinating, weight: w.coordinating, why: [
        theirs.length ? `${answered} of ${theirs.length} alerts answered by the supplier (${pctText(coordinating)})` : "No alerts yet, so a neutral 50%"] },
    ],
  };
}
