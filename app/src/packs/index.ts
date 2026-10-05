// Industry packs. Everything that differs by industry is configuration here; no code
// elsewhere may check for "Tier 1" / "Tier 2" — use these labels and helpers instead.
import type { ChainPosition, SizeBand } from "../lib/types";

export interface KpiDef {
  id: string;
  label: string;
  group: "Delivery" | "Suppliers" | "Inventory" | "Idle capacity" | "Quality" | "Waste and risk";
  unit: "%" | "days" | "MXN" | "ppm" | "t CO2e" | "level" | "per year" | "items";
  higherIsBetter: boolean;
  target?: number;
  watchBand?: number;         // within this distance of target = "watch"
  formula: string;
  data: string;               // which uploads it uses
  perCustomer?: boolean;      // also shown per key customer on scorecards
}

export interface SegmentRule { label: string; chainPosition: ChainPosition; sizeBands: SizeBand[] }

export interface Pack {
  id: string;
  name: string;
  labels: {
    keyCustomer: string;          // what this industry calls the key customer
    keyCustomerPlural: string;
    approvalProcess: string;      // name of the "customer must re-approve" process
  };
  segments: SegmentRule[];
  certifications: string[];
  materials: { id: string; label: string; factorId: string }[];
  kpis: KpiDef[];
}

export const AUTO: Pack = {
  id: "auto",
  name: "Automotive",
  labels: { keyCustomer: "Tier 1", keyCustomerPlural: "Tier 1s", approvalProcess: "PPAP" },
  segments: [
    { label: "Tier 1", chainPosition: "direct", sizeBands: ["small", "medium", "large"] },
    { label: "Tier 2", chainPosition: "sub", sizeBands: ["small", "medium", "large"] },
    { label: "Tier 3", chainPosition: "raw", sizeBands: ["micro", "small", "medium", "large"] },
  ],
  certifications: ["IATF 16949", "ISO 9001", "ISO 14001"],
  materials: [
    { id: "steel-coil", label: "Steel coil", factorId: "ef-steel-coil" },
    { id: "packaging", label: "Packaging", factorId: "ef-cardboard" },
    { id: "fasteners", label: "Fasteners", factorId: "ef-steel-coil" },
  ],
  kpis: [
    { id: "otif", label: "OTIF to customers", group: "Delivery", unit: "%", higherIsBetter: true, target: 0.98, watchBand: 0.03, perCustomer: true,
      formula: "Order lines shipped by the committed date and in full ÷ all order lines.", data: "Sales orders: committed date, ordered and shipped quantity, ship date." },
    { id: "order-to-ship", label: "Order-to-ship time", group: "Delivery", unit: "days", higherIsBetter: false, target: 3, watchBand: 2,
      formula: "Median days from order date to ship date.", data: "Sales orders: order date, ship date." },
    { id: "premium-freight", label: "Premium freight, 90 days", group: "Delivery", unit: "MXN", higherIsBetter: false, target: 150000, watchBand: 150000,
      formula: "Freight cost of trips marked as expedited.", data: "Freight invoices, or trips above MXN 20,000 confirmed as expedited during upload." },
    { id: "supplier-otif", label: "Supplier OTIF", group: "Suppliers", unit: "%", higherIsBetter: true, target: 0.95, watchBand: 0.05,
      formula: "Purchase order lines received by the promised date and in full ÷ all lines.", data: "Purchase orders and receipts." },
    { id: "lead-time-var", label: "Lead-time variability (worst supplier)", group: "Suppliers", unit: "%", higherIsBetter: false, target: 0.15, watchBand: 0.1,
      formula: "Standard deviation ÷ average of days from purchase order to receipt, per supplier.", data: "Purchase orders and receipts." },
    { id: "doi", label: "Days of inventory", group: "Inventory", unit: "days", higherIsBetter: false, target: 30, watchBand: 10,
      formula: "Inventory value ÷ average daily cost of goods sold.", data: "Inventory snapshot, item cost, shipments." },
    { id: "slow-moving", label: "Slow-moving stock", group: "Inventory", unit: "MXN", higherIsBetter: false, target: 1000000, watchBand: 1000000,
      formula: "Value of items with no movement in 90 days.", data: "Inventory movements." },
    { id: "press-util", label: "Press utilization", group: "Idle capacity", unit: "%", higherIsBetter: true, target: 0.75, watchBand: 0.15,
      formula: "Run hours ÷ available hours, per press.", data: "Production orders, plus presses and shifts from the setup form." },
    { id: "truck-fill", label: "Truck fill rate", group: "Idle capacity", unit: "%", higherIsBetter: true, target: 0.8, watchBand: 0.15,
      formula: "Pallets shipped ÷ trailer capacity (24 pallets), per trip.", data: "Shipments, units per pallet, trailer type from the setup form." },
    { id: "ppm", label: "Customer defect rate", group: "Quality", unit: "ppm", higherIsBetter: false, target: 50, watchBand: 50, perCustomer: true,
      formula: "Parts rejected by the customer ÷ parts shipped × 1,000,000.", data: "Quality and returns file." },
    { id: "ppap-level", label: "PPAP level held", group: "Quality", unit: "level", higherIsBetter: true, target: 3, watchBand: 0, perCustomer: true,
      formula: "Highest PPAP submission level approved by the customer.", data: "Certifications and approvals, from the setup form." },
    { id: "scrap", label: "Scrap rate", group: "Waste and risk", unit: "%", higherIsBetter: false, target: 0.03, watchBand: 0.02,
      formula: "Steel scrapped ÷ steel consumed.", data: "Scrap movements, material receipts." },
    { id: "theft-exposure", label: "Trips on high-theft roads", group: "Waste and risk", unit: "%", higherIsBetter: false, target: 0.3, watchBand: 0.15,
      formula: "Trips that use road segments flagged for cargo theft ÷ all trips.", data: "Shipments, routes, cargo-theft data (state level in v0)." },
  ],
};

export const PACKS: Pack[] = [AUTO];
export const getPack = (id: string) => PACKS.find((p) => p.id === id) ?? AUTO;

/** Segment label for a supplier in a relationship, e.g. "Tier 2". Falls back to a size description. */
export function segmentLabel(pack: Pack, chainPosition: ChainPosition, sizeBand: SizeBand): string {
  const rule = pack.segments.find((s) => s.chainPosition === chainPosition && s.sizeBands.includes(sizeBand));
  return rule?.label ?? `${sizeBand[0].toUpperCase()}${sizeBand.slice(1)} supplier`;
}

/** On track / watch / below for a KPI value against a target. */
export function kpiStatus(def: KpiDef, value: number, target = def.target): "on-track" | "watch" | "below" {
  if (target == null) return "on-track";
  const band = def.watchBand ?? 0;
  if (def.higherIsBetter) return value >= target ? "on-track" : value >= target - band ? "watch" : "below";
  return value <= target ? "on-track" : value <= target + band ? "watch" : "below";
}
