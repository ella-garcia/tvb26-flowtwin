// Industry view of the optimization score: how an automaker or a bank would read the same supplier base.
// Stricter than the operational score in four ways (rubric in docs/scoring-criteria.md, section 1b):
//   1. every supplier counts, not only those with a known risk in the horizon;
//   2. structural weaknesses set a floor on each week (1-2 flags: 0.5 points, 3+ flags: 1 point = Watch);
//   3. adopted optimizations work with probability EXECUTION, so "after" is an expected value with a range;
//   4. weakest link: a week that still expects >= CAP_DAYS of line stop caps the score at CAP_SCORE (Poor).
import { otifSummary, DEFAULT_OTIF_TARGET } from "./otif";
import { levelsFor, noneKey, type Choice, type ScenarioRow } from "./scenarios";
import type { Part, RiskLevel } from "./types";

export const EXECUTION = 0.75;     // chance an adopted optimization delivers its modelled effect
export const CAP_DAYS = 0.5;       // expected line-down days in one week that trigger the cap
export const CAP_SCORE = 59;       // highest score while a line stop is still expected (top of Poor)
export const NEAR_CAPACITY = 0.15; // headroom at or below this = running at 85% or more of capacity
export const CONCENTRATION = 0.4;  // share of the supplier's sales going to this customer

const PTS: Record<RiskLevel, number> = { red: 2, amber: 1, green: 0 };
export interface SupplierContext { parts: Part[]; shareOfSales?: number; otifTarget?: number }

/** Structural weaknesses an automaker or a bank would flag, from data FlowTwin already holds. */
export function structuralFlags(r: ScenarioRow, ctx: SupplierContext | undefined): string[] {
  const risk = r.risk, flags: string[] = [];
  const parts = ctx?.parts ?? [];
  if (parts.some((p) => p.singleSource && p.criticality !== "normal")) flags.push("Single-source critical part");
  if (risk.flex && risk.flex.headroom <= NEAR_CAPACITY) flags.push(`Near capacity (${Math.round((1 - risk.flex.headroom) * 100)}% used)`);
  if (ctx?.shareOfSales != null && ctx.shareOfSales > CONCENTRATION) flags.push(`Depends on you (${Math.round(ctx.shareOfSales * 100)}% of its sales)`);
  if ((risk.legs ?? []).some((l) => l.kind !== "road") || (risk.scenarios?.actions ?? []).some((a) => a.id === "customs_priority")) flags.push("Imported inputs (border, customs or port)");
  if (risk.dataStatus !== "connected") flags.push(risk.dataStatus === "invited" ? "Shares no data yet (invited)" : "Not on FlowTwin (public data only)");
  const o = otifSummary(risk.otifTrend, ctx?.otifTarget ?? DEFAULT_OTIF_TARGET);
  if (o?.grade === "C") flags.push("Delivery grade C");
  if (risk.flex && !risk.flex.canAbsorb) flags.push("Cannot absorb +15% demand");
  return flags;
}

export const structuralFloor = (flags: number) => (flags >= 3 ? 1 : flags >= 1 ? 0.5 : 0);

const short = (r: ScenarioRow, key: string | undefined, weeks: number) => {
  const c = r.risk.scenarios?.combos;
  return ((c?.[key ?? noneKey(r.risk)] ?? c?.[noneKey(r.risk)]) ?? []).slice(0, weeks).map((w) => w.shortDays ?? 0);
};

interface Week { pts: number; down: number }

function score(perSupplier: Week[][], weeks: number) {
  const n = perSupplier.length;
  if (!n) return { score: 100, capped: false };
  const pts = perSupplier.reduce((s, ws) => s + ws.reduce((a, w) => a + w.pts, 0), 0);
  const raw = Math.round(100 * (1 - pts / (2 * n * weeks)));
  const capped = perSupplier.some((ws) => ws.some((w) => w.down >= CAP_DAYS));
  return { score: capped ? Math.min(raw, CAP_SCORE) : raw, capped };
}

/** Industry score before (no action), after (expected, with execution risk) and the after range. */
export function industryScore(rows: ScenarioRow[], choice: Choice, weeks: number, ctx: Map<string, SupplierContext>) {
  const flagged = rows.map((r) => ({ id: r.id, name: r.name, flags: structuralFlags(r, ctx.get(r.id)) }));
  const floor = new Map(flagged.map((f) => [f.id, structuralFloor(f.flags.length)]));
  const weeksOf = (r: ScenarioRow, key: string | undefined, mix?: string): Week[] => {
    const lv = levelsFor(r.risk, key, weeks), dn = short(r, key, weeks);
    const lvB = mix === undefined ? lv : levelsFor(r.risk, undefined, weeks), dnB = mix === undefined ? dn : short(r, undefined, weeks);
    const f = floor.get(r.id) ?? 0;
    return lv.map((l, k) => {
      const p = Math.max(PTS[l], f), pB = Math.max(PTS[lvB[k]], f);
      return mix === undefined ? { pts: p, down: dn[k] ?? 0 }
        : { pts: EXECUTION * p + (1 - EXECUTION) * pB, down: EXECUTION * (dn[k] ?? 0) + (1 - EXECUTION) * (dnB[k] ?? 0) };
    });
  };
  const before = score(rows.map((r) => weeksOf(r, undefined)), weeks);
  const best = score(rows.map((r) => weeksOf(r, choice[r.id])), weeks);
  const expected = score(rows.map((r) => weeksOf(r, choice[r.id], "expected")), weeks);
  // Who triggers the cap: suppliers with a week at or above CAP_DAYS of expected line stop.
  const capBy = (mix: boolean) => rows.filter((r) => (mix ? weeksOf(r, choice[r.id], "expected") : weeksOf(r, undefined)).some((w) => w.down >= CAP_DAYS)).map((r) => r.name);
  return {
    before: before.score, beforeCapped: before.capped, beforeCapBy: capBy(false),
    after: expected.score, afterCapped: expected.capped, afterCapBy: capBy(true),
    range: { low: before.score, high: best.score },
    flagged: flagged.filter((f) => f.flags.length).sort((a, b) => b.flags.length - a.flags.length),
    suppliers: rows.length,
  };
}
