// Performance view (key customer): how suppliers have been doing and where things stand today.
// Pure functions: inputs come scoped to the viewer; every figure carries its formula for <FormulaSource>.
// Quantities are converted to days of usage (quantity ÷ the part's daily usage) so parts in pieces and in kg add up.
// No money here (BRIEF money rule): counts, days and percentages only.
import { otifSummary, type OtifGrade } from "./otif";
import { stopDaysFor } from "./programs";
import { CRIT_RANK, partStock } from "./stock";
import type { TrackSummary } from "./trackData";
import { days as fmtDays, num, pct, riskWord } from "./format";
import type { Alert, Part, Receipt, RiskAssessment, RiskHistoryRow, RiskLevel, Signal, SignalKind } from "./types";

export interface PerformanceInputs {
  asOf: string;
  customerId: string;
  companies: { id: string; name: string }[];
  parts: Part[];
  risks: RiskAssessment[];
  alerts: Alert[];
  signals: Signal[];
  receipts: Receipt[];
  history: RiskHistoryRow[];
  track: TrackSummary | null;
  sample: boolean;
}

export type PeriodDays = 30 | 90 | 180;
export interface PerformanceFilter { periodDays: PeriodDays; programId: string; supplierId?: string }

export interface KpiTile {
  id: "act-now" | "soonest-stop" | "below-cover" | "otif" | "days-late" | "hit-rate";
  label: string;
  value: number | null;
  unit: "count" | "days" | "pct";
  display: string;
  /** amount: the size of the change without a glyph (the stat card adds ▲/▼); display: the full sentence. */
  delta?: { value: number; amount: string; display: string; vs: "previous period" | "7 days ago"; better: "up" | "down"; improved: boolean };
  provenance: "measured" | "estimated";
  formula: string;
  data: string;
}

export interface SupplierPanel {
  supplierId: string;
  name: string;
  level: RiskLevel;
  levelWord: string;
  daysToLineStop: number | null;
  score: number;
  parts: { partId: string; number: string; coverDays: number; transitDays: number | null; short: boolean; criticality: Part["criticality"] }[];
  otif: { weeks: number[]; grade: OtifGrade | null };
  dataStatus: RiskAssessment["dataStatus"];
}

export interface KindSlice { kind: SignalKind; label: string; suppliers: number; share: number }

export interface MonthDelivery {
  month: string;               // "2026-09"
  orderedDays: number;         // Σ ordered ÷ daily usage
  receivedDays: number;
  shortDays: number;           // max(0, ordered − received)
  lines: number;
  lateLines: number;
  onTimeInFull: number | null; // 0..1; null when no line was due
}

export interface DayPoint {
  date: string;
  red: number | null;          // null = no snapshot that day (a gap, not zero)
  amber: number | null;
  green: number | null;
  avgScore: number | null;
  flag?: "max" | "min";
}

export interface PerformanceModel {
  period: { from: string; to: string; previousFrom: string; previousTo: string; days: PeriodDays };
  kpis: KpiTile[];
  suppliers: SupplierPanel[];
  disruptions: { slices: KindSlice[]; affected: number };
  deliveries: MonthDelivery[];
  trend: DayPoint[];
  sample: boolean;
}

export const KIND_LABEL: Record<SignalKind, string> = {
  weather: "Weather", road: "Road closure", blockade: "Blockade", customs: "Customs", port: "Port", theft: "Theft",
  supplier: "Supplier event", policy: "Trade policy", "supplier-input": "Input shortage",
};
const KINDS = Object.keys(KIND_LABEL) as SignalKind[];
export const TREND_DAYS = 31;
export const TOP_SUPPLIERS = 10;
export const MAX_MONTHS = 6;

/** Axis top for three even ticks (0, step, 2 × step) with a round step: 11 days → 0, 6, 12. */
export function evenTop(v: number): number {
  const half = Math.max(1, v / 2);
  const step = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50].find((x) => x >= half) ?? Math.ceil(half / 10) * 10;
  return step * 2;
}

// ---------------------------------------------------------------- dates
const DAY = 864e5;
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(t(iso) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

// ---------------------------------------------------------------- receipts
/** Days a line is late as of asOf: received → received − promised; not received and due → asOf − promised. */
export function daysLate(r: Receipt, asOf: string): number {
  if (r.receivedDate) return Math.max(0, daysBetween(r.promisedDate, r.receivedDate));
  return r.promisedDate < asOf ? daysBetween(r.promisedDate, asOf) : 0;
}

/** A line counts once it is received or its promised date has passed. */
const isDue = (r: Receipt, asOf: string) => !!r.receivedDate || r.promisedDate < asOf;
export const inFull = (r: Receipt) => !!r.receivedDate && r.quantityReceived >= r.quantityOrdered;
export const onTimeInFull = (r: Receipt, asOf: string) => inFull(r) && daysLate(r, asOf) === 0;

interface ReceiptStats { lines: number; otif: number | null; avgDaysLate: number | null; late: number }
export function receiptStats(rs: Receipt[], asOf: string): ReceiptStats {
  const due = rs.filter((r) => isDue(r, asOf));
  const late = due.map((r) => daysLate(r, asOf)).filter((d) => d > 0);
  return {
    lines: due.length,
    otif: due.length ? due.filter((r) => onTimeInFull(r, asOf)).length / due.length : null,
    avgDaysLate: late.length ? late.reduce((a, b) => a + b, 0) / late.length : null,
    late: late.length,
  };
}

// ---------------------------------------------------------------- filter
function scopeInputs(i: PerformanceInputs, f: PerformanceFilter) {
  const parts = i.parts.filter((p) => p.customerId === i.customerId
    && (f.programId === "all" || (p.programIds ?? []).includes(f.programId))
    && (!f.supplierId || p.supplierId === f.supplierId));
  const partIds = new Set(parts.map((p) => p.id));
  const narrowed = f.programId !== "all" || !!f.supplierId;
  const suppliers = new Set(narrowed ? parts.map((p) => p.supplierId)
    : i.risks.filter((r) => r.customerId === i.customerId).map((r) => r.supplierId));
  return {
    parts,
    partsById: new Map(i.parts.map((p) => [p.id, p])),
    risks: i.risks.filter((r) => r.customerId === i.customerId && suppliers.has(r.supplierId)),
    receipts: i.receipts.filter((r) => r.customerId === i.customerId && suppliers.has(r.supplierId)
      && (!narrowed || (r.partId != null && partIds.has(r.partId)))),
    history: i.history.filter((h) => h.customerId === i.customerId && suppliers.has(h.supplierId)),
    suppliers,
  };
}

// ---------------------------------------------------------------- build
export function buildPerformance(i: PerformanceInputs, f: PerformanceFilter): PerformanceModel {
  const to = i.asOf, from = addDays(to, -(f.periodDays - 1));
  const previousTo = addDays(from, -1), previousFrom = addDays(previousTo, -(f.periodDays - 1));
  const s = scopeInputs(i, f);
  // With a vehicle model selected, days to line stop come from that model's parts (as on the risk board).
  const narrowed = f.programId !== "all" || !!f.supplierId;
  const riskOf = new Map(s.risks.map((r) => [r.supplierId, narrowed
    ? { ...r, daysToLineStop: stopDaysFor(r, s.parts.filter((p) => p.supplierId === r.supplierId)) } : r]));
  return {
    period: { from, to, previousFrom, previousTo, days: f.periodDays },
    kpis: kpis(i, s, riskOf, { from, to, previousFrom, previousTo }, f.periodDays),
    suppliers: supplierPanels(i, s, riskOf),
    disruptions: disruptions(s.risks, i.signals),
    deliveries: deliveries(s.receipts, s.partsById, from, to, i.asOf),
    trend: trend(s.history, i.asOf),
    sample: i.sample,
  };
}

type Scoped = ReturnType<typeof scopeInputs>;

function kpis(i: PerformanceInputs, s: Scoped, riskOf: Map<string, RiskAssessment>,
  p: { from: string; to: string; previousFrom: string; previousTo: string }, periodDays: number): KpiTile[] {
  const red = s.risks.filter((r) => r.level === "red").length;
  const weekAgo = addDays(i.asOf, -7);
  const then = s.history.filter((h) => h.asOf === weekAgo);
  const redThen = then.length ? then.filter((h) => h.level === "red").length : null;
  const stops = [...riskOf.values()].map((r) => r.daysToLineStop).filter((d): d is number => d != null);
  const soonest = stops.length ? Math.min(...stops) : null;
  const below = s.parts.filter((pt) => partStock(pt, riskOf.get(pt.supplierId), i.asOf).status === "short").length;
  const now = receiptStats(s.receipts.filter((r) => inRange(r.promisedDate, p.from, p.to)), i.asOf);
  // Compare with the previous period only when the receipts reach back to its first day; a partial period misleads.
  const earliest = s.receipts.reduce<string | null>((m, r) => (m == null || r.promisedDate < m ? r.promisedDate : m), null);
  const before = earliest != null && earliest <= p.previousFrom
    ? receiptStats(s.receipts.filter((r) => inRange(r.promisedDate, p.previousFrom, p.previousTo)), i.asOf)
    : { lines: 0, otif: null, avgDaysLate: null, late: 0 };
  const rate = i.track?.rate ?? null;
  const noData = "No data yet";
  const period = `the last ${periodDays} days`;
  return [
    { id: "act-now", label: "Suppliers at Act now", value: red, unit: "count", display: num(red),
      delta: redThen == null ? undefined : delta(red - redThen, "7 days ago", "down", (v) => num(Math.abs(v))),
      provenance: "estimated", formula: "Suppliers whose risk light is red (Act now) today.",
      data: "Risk assessments from the 14-day projection; the change compares with the risk snapshot 7 days ago." },
    { id: "soonest-stop", label: "Soonest line stop", value: soonest, unit: "days",
      display: soonest == null ? "None in 14 days" : fmtDays(soonest), provenance: "estimated",
      formula: "Fewest days until a line stops if nothing is done, over all suppliers.",
      data: "Days to line stop from each supplier's 14-day projection against your stock of its parts." },
    { id: "below-cover", label: "Parts below safe cover", value: below, unit: "count", display: num(below), provenance: "estimated",
      formula: "Parts whose stock runs out before the next delivery arrives.",
      data: "Your stock per part, its daily usage, and the next delivery date (or the expected transit time when no date is known)." },
    { id: "otif", label: "On time in full", value: now.otif, unit: "pct", display: now.otif == null ? noData : pct(now.otif, 1),
      delta: now.otif == null || before.otif == null ? undefined
        : delta(now.otif - before.otif, "previous period", "up", (v) => `${(Math.abs(v) * 100).toFixed(1)} pts`),
      provenance: "measured",
      formula: `Receipt lines delivered on or before the promised date and in full ÷ lines due, over ${period}.`,
      data: `Your goods receipts (promised and received date, ordered and received quantity); ${num(now.lines)} lines due.` },
    { id: "days-late", label: "Average days late", value: now.avgDaysLate, unit: "days",
      display: now.avgDaysLate == null ? (now.lines ? "None late" : noData) : fmtDays(Math.round(now.avgDaysLate * 10) / 10),
      delta: now.avgDaysLate == null || before.avgDaysLate == null ? undefined
        : delta(now.avgDaysLate - before.avgDaysLate, "previous period", "down", (v) => fmtDays(Math.round(Math.abs(v) * 10) / 10)),
      provenance: "measured",
      formula: `Mean of (received − promised date) over late lines only, over ${period}; on-time lines are left out. A line not received yet counts up to today.`,
      data: `Your goods receipts; ${num(now.late)} of ${num(now.lines)} lines were late.` },
    { id: "hit-rate", label: "Alert hit rate", value: rate, unit: "pct", display: rate == null ? noData : pct(rate, 0),
      provenance: "measured",
      formula: "(Hit + prevented) ÷ (hit + prevented + false alarm), over alerts raised in the last 90 days, for all vehicle models.",
      data: "Alert outcomes judged from goods receipts and shipment notices (track record rules v1)." },
  ];
}

function delta(value: number, vs: "previous period" | "7 days ago", better: "up" | "down", show: (v: number) => string) {
  const improved = better === "up" ? value > 0 : value < 0;
  const sign = value > 0 ? "▲" : value < 0 ? "▼" : "";
  return { value, amount: show(value), display: value === 0 ? `No change vs ${vs}` : `${sign} ${show(value)} vs ${vs}`, vs, better, improved };
}

function supplierPanels(i: PerformanceInputs, s: Scoped, riskOf: Map<string, RiskAssessment>): SupplierPanel[] {
  const name = new Map(i.companies.map((c) => [c.id, c.name]));
  const rows = [...riskOf.values()].map((r) => {
    const own = s.parts.filter((p) => p.supplierId === r.supplierId).map((p) => ({ p, st: partStock(p, r, i.asOf) }));
    const short = own.filter((x) => x.st.status === "short");
    const critRank = short.length ? Math.min(...short.map((x) => CRIT_RANK[x.p.criticality])) : 3;
    const parts = own
      .sort((a, b) => CRIT_RANK[a.p.criticality] - CRIT_RANK[b.p.criticality] || a.p.daysOfCover - b.p.daysOfCover)
      .slice(0, 3)
      .map(({ p, st }) => ({ partId: p.id, number: p.number, coverDays: p.daysOfCover, transitDays: st.nextDeliveryDays,
        short: st.status === "short", criticality: p.criticality }));
    const sum = otifSummary(r.otifTrend ?? []);
    const panel: SupplierPanel = { supplierId: r.supplierId, name: name.get(r.supplierId) ?? r.supplierId, level: r.level,
      levelWord: riskWord(r.level), daysToLineStop: r.daysToLineStop, score: r.score, parts,
      otif: { weeks: r.otifTrend ?? [], grade: sum?.grade ?? null }, dataStatus: r.dataStatus };
    return { panel, critRank };
  });
  // Same order as the risk board: days to line stop (none last), then the most critical short part, then score.
  rows.sort((a, b) => (a.panel.daysToLineStop ?? Infinity) - (b.panel.daysToLineStop ?? Infinity)
    || a.critRank - b.critRank || b.panel.score - a.panel.score || a.panel.name.localeCompare(b.panel.name));
  return rows.slice(0, TOP_SUPPLIERS).map((r) => r.panel);
}

function disruptions(risks: RiskAssessment[], signals: Signal[]): { slices: KindSlice[]; affected: number } {
  const sig = new Map(signals.map((x) => [x.id, x]));
  const per = new Map<SignalKind, number>();
  let affected = 0;
  for (const r of risks) {
    const kinds = new Set<SignalKind>();
    for (const d of r.drivers ?? []) {
      if (!(KINDS as string[]).includes(d.kind) || d.contribution <= 0) continue;
      if (d.signalId && sig.get(d.signalId)?.active === false) continue;
      kinds.add((d.signalId && sig.get(d.signalId)?.kind) || (d.kind as SignalKind));
    }
    if (kinds.size) affected += 1;
    for (const k of kinds) per.set(k, (per.get(k) ?? 0) + 1);
  }
  const slices = KINDS.filter((k) => per.has(k)).map((k) => ({ kind: k, label: KIND_LABEL[k], suppliers: per.get(k)!,
    share: affected ? per.get(k)! / affected : 0 }));
  slices.sort((a, b) => b.suppliers - a.suppliers);
  return { slices, affected };
}

function deliveries(rs: Receipt[], partsById: Map<string, Part>, from: string, to: string, asOf: string): MonthDelivery[] {
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7);) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  const keep = months.slice(-MAX_MONTHS);
  return keep.map((month) => {
    const due = rs.filter((r) => r.promisedDate.startsWith(month) && inRange(r.promisedDate, from, to) && isDue(r, asOf));
    let orderedDays = 0, receivedDays = 0;
    for (const r of due) {
      const usage = r.partId ? partsById.get(r.partId)?.dailyUsage : undefined;
      if (!usage) continue; // lines without a known part count in `lines` only
      orderedDays += r.quantityOrdered / usage;
      receivedDays += (r.receivedDate ? r.quantityReceived : 0) / usage;
    }
    const st = receiptStats(due, asOf);
    const round = (v: number) => Math.round(v * 10) / 10;
    return { month, orderedDays: round(orderedDays), receivedDays: round(receivedDays),
      shortDays: round(Math.max(0, orderedDays - receivedDays)), lines: st.lines, lateLines: st.late, onTimeInFull: st.otif };
  });
}

function trend(history: RiskHistoryRow[], asOf: string): DayPoint[] {
  const points: DayPoint[] = [];
  for (let k = TREND_DAYS - 1; k >= 0; k -= 1) {
    const d = addDays(asOf, -k);
    const rows = history.filter((h) => String(h.asOf).slice(0, 10) === d);
    if (!rows.length) { points.push({ date: d, red: null, amber: null, green: null, avgScore: null }); continue; }
    const n = (l: RiskLevel) => rows.filter((h) => h.level === l).length;
    points.push({ date: d, red: n("red"), amber: n("amber"), green: n("green"),
      avgScore: Math.round(rows.reduce((a, h) => a + h.score, 0) / rows.length * 10) / 10 });
  }
  const scored = points.filter((x) => x.avgScore != null);
  if (scored.length > 1) {
    const max = scored.reduce((a, b) => (b.avgScore! >= a.avgScore! ? b : a));
    const min = scored.reduce((a, b) => (b.avgScore! < a.avgScore! ? b : a));
    if (max !== min) { max.flag = "max"; min.flag = "min"; }
  }
  return points;
}
