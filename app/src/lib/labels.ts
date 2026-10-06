// Words and pill tones for statuses shown on more than one page, so every page says the same thing.
import type { PillTone } from "../keystone";
import type { Alert, Part, RiskAssessment } from "./types";

type Labelled = { label: string; tone: PillTone };

/** Part criticality, most critical first (same order as CRIT_RANK in lib/stock.ts). */
export const CRIT_LABEL: Record<Part["criticality"], string> = { "line-stopper": "Line stopper", high: "High", normal: "Normal" };
export const CRIT_TONE: Record<Part["criticality"], PillTone> = { "line-stopper": "danger", high: "warning", normal: "neutral" };

/** How much of the supplier's own data feeds its risk score. */
export const DATA_STATUS: Record<RiskAssessment["dataStatus"], Labelled> = {
  connected: { label: "Connected", tone: "success" },
  invited: { label: "Invited", tone: "neutral" },
  "public-only": { label: "Public data only", tone: "warning" },
};

/** Alert status as the key customer sees it. Tones are the same for every audience. */
export const ALERT_STATUS: Record<Alert["status"], Labelled> = {
  new: { label: "New", tone: "danger" },
  acknowledged: { label: "Acknowledged", tone: "warning" },
  "supplier-responded": { label: "Supplier responded", tone: "fresh" },
  resolved: { label: "Resolved", tone: "success" },
};

/** Alert status words for the supplier the alert is about. */
export const ALERT_STATUS_FOR_SUPPLIER: Record<Alert["status"], string> = {
  new: "Needs your answer", acknowledged: "Seen by customer", "supplier-responded": "You answered", resolved: "Resolved",
};
