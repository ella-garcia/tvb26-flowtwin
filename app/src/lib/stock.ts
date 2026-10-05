// Stock position of one part along the pipeline: at the key customer, on the road, at the supplier.
// Shared by the risk board, the parts page and the supplier page so they always agree.
import type { Part, RiskAssessment } from "./types";

export type StockStatus = "short" | "tight" | "ok";

export interface PartStock {
  part: Part;
  /** (on hand + in transit) ÷ daily usage. Equals daysOfCover when in-transit is unknown. */
  pipelineCoverDays: number;
  /** Supplier finished goods ÷ daily usage; null when the supplier does not share it. */
  supplierCoverDays: number | null;
  /** About when stock here runs out if nothing arrives (asOf + days of cover). */
  runsOutDate: string;
  /** Days from asOf until the next delivery arrives; null when there is no estimate. */
  nextDeliveryDays: number | null;
  nextDeliveryDate: string | null;
  /** True when the date is estimated from expected transit rather than given by an ASN or the supplier. */
  nextDeliveryEstimated: boolean;
  /** short: stock runs out before the next delivery. tight: less than one day of margin. */
  status: StockStatus;
}

const DAY = 864e5;
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const atNoon = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00Z").getTime();

export function partStock(part: Part, risk: RiskAssessment | undefined, asOf: string): PartStock {
  const t0 = atNoon(asOf);
  const usage = part.dailyUsage || 0;
  let nextDeliveryDays: number | null = null, nextDeliveryDate: string | null = null, estimated = false;
  if (part.nextDeliveryDate) {
    nextDeliveryDate = part.nextDeliveryDate.slice(0, 10);
    nextDeliveryDays = Math.max(0, Math.round((atNoon(nextDeliveryDate) - t0) / DAY));
  } else if (risk) {
    // Deliveries land on whole days: a 1.1-day expected transit arrives on day 2.
    nextDeliveryDays = Math.ceil(risk.expectedTransitDays);
    nextDeliveryDate = toIso(t0 + nextDeliveryDays * DAY);
    estimated = true;
  }
  const cover = part.daysOfCover;
  const status: StockStatus = nextDeliveryDays == null ? "ok"
    : cover < nextDeliveryDays ? "short" : cover < nextDeliveryDays + 1 ? "tight" : "ok";
  return {
    part,
    pipelineCoverDays: usage ? (part.onHand + (part.inTransit ?? 0)) / usage : cover,
    supplierCoverDays: part.supplierFgOnHand != null && usage ? part.supplierFgOnHand / usage : null,
    runsOutDate: toIso(t0 + Math.floor(cover) * DAY),
    nextDeliveryDays, nextDeliveryDate, nextDeliveryEstimated: estimated,
    status,
  };
}

export const CRIT_RANK: Record<Part["criticality"], number> = { "line-stopper": 0, high: 1, normal: 2 };
