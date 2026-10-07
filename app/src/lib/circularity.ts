// Circularity score (0-100) from a supplier's SHARED circular summary. Pure.
// A first proxy for the "circular practices" construct in Sadiq et al. (2026), Technovation 157, 103653.
// It is NOT validated: equal weights over the fields present, self-reported data, no audit.
import type { CircularSummary, ScrapRoute } from "./types";

export const SCRAP_ROUTE_SCORE: Record<ScrapRoute, number> = { landfill: 0, unknown: 0.2, recycler: 0.7, "mill-return": 1, "internal-remelt": 1 };
export const SCRAP_ROUTE_LABEL: Record<ScrapRoute, string> = {
  landfill: "Landfill", unknown: "Unknown", recycler: "Recycler", "mill-return": "Returned to mill", "internal-remelt": "Remelted in-house",
};

export const CIRCULARITY_FORMULA =
  "Score = 100 × average of the fields shared: scrap route (landfill 0, unknown 0.2, recycler 0.7, returned to mill or remelted in-house 1), recycled content %, returnable packaging %, renewable electricity %, and ISO 14001 (1 if certified, else 0). " +
  "Equal weights; fields a supplier left blank are skipped, not counted as zero. A first proxy for the paper's circular-practices construct, not validated.";

export interface CircularityComponent { key: string; label: string; value: number; note: string }
export interface Circularity { score: number; components: CircularityComponent[]; missing: string[] }

const pctText = (v: number) => `${Math.round(v * 100)}%`;

export function circularityScore(s: CircularSummary): Circularity {
  const components: CircularityComponent[] = [];
  const missing: string[] = [];
  const route = s.scrapRoute ?? "unknown";
  components.push({ key: "scrapRoute", label: "Scrap route", value: SCRAP_ROUTE_SCORE[route] ?? 0.2, note: SCRAP_ROUTE_LABEL[route] ?? "Unknown" });
  const frac = (key: string, label: string, v: number | undefined) => {
    if (v == null || Number.isNaN(v)) { missing.push(label); return; }
    const c = Math.max(0, Math.min(1, v));
    components.push({ key, label, value: c, note: pctText(c) });
  };
  frac("recycledContentPct", "Recycled content", s.recycledContentPct);
  frac("returnablePackagingPct", "Returnable packaging", s.returnablePackagingPct);
  frac("renewableElectricityPct", "Renewable electricity", s.renewableElectricityPct);
  components.push({ key: "iso14001", label: "ISO 14001", value: s.iso14001 ? 1 : 0, note: s.iso14001 ? "Certified" : "Not certified" });
  const score = Math.round(100 * (components.reduce((a, c) => a + c.value, 0) / components.length));
  return { score, components, missing };
}
