// What-if: combine the engine's precomputed per-supplier results (risk.scenarios) for a chosen set of actions.
// No risk logic here: every weekly level comes from the engine; this file only picks combinations and counts.
import type { Part, RiskAssessment, RiskLevel, VehicleProgram } from "./types";

export type Choice = Record<string, string>; // supplierId -> combo key ("0"/"1" per recommended action)
export interface ScenarioRow { id: string; name: string; risk: RiskAssessment }

export const noneKey = (r: RiskAssessment) => "0".repeat(r.scenarios?.actions.length ?? 0);
export const allKey = (r: RiskAssessment) => "1".repeat(r.scenarios?.actions.length ?? 0);

/** Weekly levels for a supplier with the chosen actions (no actions when the risk has no scenarios). */
export function levelsFor(r: RiskAssessment, key: string | undefined, weeks: number): RiskLevel[] {
  const combos = r.scenarios?.combos;
  const res = combos?.[key ?? noneKey(r)] ?? combos?.[noneKey(r)];
  if (res) return res.slice(0, weeks).map((w) => w.level);
  return (r.outlook ?? []).slice(0, weeks).map((w) => w.level);
}

/** A supplier is worth acting on if any week in the horizon is not OK. */
export const actionable = (r: RiskAssessment, weeks: number) => levelsFor(r, undefined, weeks).some((l) => l !== "green");

export interface Totals { high: number; watch: number; suppliersHigh: number; perWeek: { high: number; watch: number }[] }

export function totals(rows: ScenarioRow[], choice: Choice, weeks: number): Totals {
  const perWeek = Array.from({ length: weeks }, () => ({ high: 0, watch: 0 }));
  let high = 0, watch = 0, suppliersHigh = 0;
  for (const r of rows) {
    const ls = levelsFor(r.risk, choice[r.id], weeks);
    if (ls.includes("red")) suppliersHigh++;
    ls.forEach((l, i) => {
      if (l === "red") { high++; perWeek[i].high++; }
      else if (l === "amber") { watch++; perWeek[i].watch++; }
    });
  }
  return { high, watch, suppliersHigh, perWeek };
}

/** Small seeded PRNG (mulberry32) so a "Randomize" draw can be repeated and shown to others. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Each actionable supplier adopts all its recommended actions with probability `share`. */
export function randomChoice(rows: ScenarioRow[], share: number, weeks: number, rand: () => number): Choice {
  const c: Choice = {};
  for (const r of rows) c[r.id] = actionable(r.risk, weeks) && rand() < share ? allKey(r.risk) : noneKey(r.risk);
  return c;
}

/** `draws` random adoptions: P10, median and P90 of High and Watch supplier-weeks. */
export function drawStats(rows: ScenarioRow[], share: number, weeks: number, draws = 500, seed = 7) {
  const rand = rng(seed);
  const hi: number[] = [], wa: number[] = [];
  for (let i = 0; i < draws; i++) {
    const t = totals(rows, randomChoice(rows, share, weeks, rand), weeks);
    hi.push(t.high); wa.push(t.watch);
  }
  const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return { high: { p10: q(hi, 0.1), p50: q(hi, 0.5), p90: q(hi, 0.9) }, watch: { p10: q(wa, 0.1), p50: q(wa, 0.5), p90: q(wa, 0.9) } };
}

// ---------------------------------------------------------------- optimization views (score, levers, uptime, money)

/** Weekly results (level, extraDays, shortDays) for a combo key; falls back to "no action". */
export const weekOf = (r: RiskAssessment, key: string | undefined) => {
  const c = r.scenarios?.combos;
  return c?.[key ?? noneKey(r)] ?? c?.[noneKey(r)];
};

/** 0-100 health of the suppliers that have a risk in the horizon: 100 = all their weeks OK; High counts double.
 *  Suppliers that are OK all along are left out, so the score moves with the optimizations that matter. */
export function score(rows: ScenarioRow[], choice: Choice, weeks: number): number {
  const atRisk = rows.filter((r) => actionable(r.risk, weeks));
  if (!atRisk.length) return 100;
  const t = totals(atRisk, choice, weeks);
  return Math.round(100 * (1 - (2 * t.high + t.watch) / (2 * atRisk.length * weeks)));
}

/** Levers: which kind of optimization an action is. */
export const LEVER: Record<string, string> = {
  alt_route: "Route & weather", customs_priority: "Customs", daytime: "Security", ship_plan: "Supplier operations",
  safety_stock: "Stock", pull_forward: "Stock", second_source: "Second source",
};
const RANKS: Record<RiskLevel, number> = { red: 2, amber: 1, green: 0 };

/** Each action on its own (vs no action), summed by lever: risk-weeks improved and line-down days avoided. */
export function leverBenefit(rows: ScenarioRow[], weeks: number) {
  const out = new Map<string, { lever: string; improved: number; downAvoided: number; suppliers: number }>();
  for (const r of rows) {
    const acts = r.risk.scenarios?.actions ?? [];
    const base = weekOf(r.risk, undefined)?.slice(0, weeks);
    if (!base) continue;
    acts.forEach((a, i) => {
      const key = acts.map((_, j) => (j === i ? "1" : "0")).join("");
      const one = weekOf(r.risk, key)?.slice(0, weeks);
      if (!one) return;
      const lever = LEVER[a.id] ?? a.label;
      const e = out.get(lever) ?? { lever, improved: 0, downAvoided: 0, suppliers: 0 };
      const improved = base.reduce((s, w, k) => s + Math.max(0, RANKS[w.level] - RANKS[one[k].level]), 0);
      const down = base.reduce((s, w, k) => s + Math.max(0, (w.shortDays ?? 0) - (one[k].shortDays ?? 0)), 0);
      if (improved > 0 || down > 0) e.suppliers++;
      e.improved += improved; e.downAvoided += down;
      out.set(lever, e);
    });
  }
  return [...out.values()].sort((a, b) => b.improved - a.improved || b.downAvoided - a.downAvoided);
}

/** Days per week each model's line would be down: the worst shortDays among suppliers of its line-stopper/high parts. */
export function downDays(rows: ScenarioRow[], choice: Choice, weeks: number, programs: VehicleProgram[], parts: Part[]) {
  const res: Record<string, number[]> = {};
  for (const g of programs) {
    const feeding = new Set(parts.filter((p) => p.programIds?.includes(g.id) && p.criticality !== "normal").map((p) => p.supplierId));
    const d = Array.from({ length: weeks }, () => 0);
    for (const r of rows) {
      if (!feeding.has(r.id)) continue;
      weekOf(r.risk, choice[r.id])?.slice(0, weeks).forEach((w, k) => { d[k] = Math.max(d[k], w.shortDays ?? 0); });
    }
    res[g.id] = d;
  }
  return res;
}

/** Weekly line uptime (0..1) per model and overall (weighted by planned vehicles per day). */
export function uptime(down: Record<string, number[]>, programs: VehicleProgram[], weeks: number) {
  const per: Record<string, number[]> = {};
  for (const g of programs) per[g.id] = (down[g.id] ?? []).map((d) => 1 - d / 7);
  const total = programs.reduce((s, g) => s + g.dailyVehicles, 0) || 1;
  const overall = Array.from({ length: weeks }, (_, k) => programs.reduce((s, g) => s + (per[g.id]?.[k] ?? 1) * g.dailyVehicles, 0) / total);
  return { per, overall };
}

/** Vehicles not built and revenue lost per model (MXN; estimated from revenuePerVehicleMxn). */
export function revenueLost(down: Record<string, number[]>, programs: VehicleProgram[]) {
  return programs.map((g) => {
    const days = (down[g.id] ?? []).reduce((a, b) => a + b, 0);
    const vehicles = Math.round(days * g.dailyVehicles);
    return { program: g, days, vehicles, mxn: vehicles * (g.revenuePerVehicleMxn ?? 0) };
  });
}

/** Stock added by the chosen stock actions, per critical part: added days x daily usage x unit cost (MXN). */
const STOCK_DAYS: Record<string, number> = { safety_stock: 2, pull_forward: 1.5 };
export function actionCost(rows: ScenarioRow[], choice: Choice, parts: Part[]) {
  const out: { part: Part; action: string; label: string; units: number; mxn: number }[] = [];
  const notCosted = new Set<string>();
  for (const r of rows) {
    const acts = r.risk.scenarios?.actions ?? [];
    const key = choice[r.id] ?? noneKey(r.risk);
    acts.forEach((a, i) => {
      if (key[i] !== "1") return;
      const d = STOCK_DAYS[a.id];
      if (d == null) { notCosted.add(a.label); return; }
      for (const p of parts.filter((x) => x.supplierId === r.id && x.criticality !== "normal")) {
        const units = Math.round(d * p.dailyUsage);
        out.push({ part: p, action: a.id, label: a.label, units, mxn: units * p.unitCostMxn });
      }
    });
  }
  return { lines: out.sort((a, b) => b.mxn - a.mxn), notCosted: [...notCosted] };
}

/** The draw for a scenario state. Suppliers are ordered by id first, so every page gets the same draw. */
export function scenarioChoice(rows: ScenarioRow[], s: { share: number; seed: number; weeks: number; overrides: Choice }): Choice {
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return { ...randomChoice(ordered, s.share, s.weeks, rng(s.seed)), ...s.overrides };
}

/** Every supplier with a risk in the horizon adopts all its actions (all = true), or none does. */
export function everyone(rows: ScenarioRow[], weeks: number, all: boolean): Choice {
  const o: Choice = {};
  for (const r of rows) o[r.id] = all && actionable(r.risk, weeks) ? allKey(r.risk) : noneKey(r.risk);
  return o;
}

/** Everything the optimization views need for one choice vs no action. */
export function optimizationView(rows: ScenarioRow[], choice: Choice, weeks: number, programs: VehicleProgram[], parts: Part[]) {
  const downBefore = downDays(rows, {}, weeks, programs, parts), downAfter = downDays(rows, choice, weeks, programs, parts);
  const upBefore = uptime(downBefore, programs, weeks), upAfter = uptime(downAfter, programs, weeks);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);
  const revB = revenueLost(downBefore, programs), revA = revenueLost(downAfter, programs);
  return {
    scoreBefore: score(rows, {}, weeks), scoreAfter: score(rows, choice, weeks),
    levers: leverBenefit(rows, weeks),
    uptimeBefore: upBefore.overall, uptimeAfter: upAfter.overall,
    models: programs.map((g) => ({ program: g, before: avg(upBefore.per[g.id] ?? []), after: avg(upAfter.per[g.id] ?? []) })),
    revenue: programs.map((g, i) => ({ program: g, before: revB[i].mxn, after: revA[i].mxn, vehiclesBefore: revB[i].vehicles, vehiclesAfter: revA[i].vehicles })),
    cost: actionCost(rows, choice, parts),
    acting: rows.filter((r) => actionable(r.risk, weeks)).length,
    actingNow: rows.filter((r) => actionable(r.risk, weeks) && (choice[r.id] ?? noneKey(r.risk)).includes("1")).length,
  };
}

// ---------------------------------------------------------------- money views (What-if only, MXN, estimated)

/** Revenue lost per week across models (MXN): line-down days x planned vehicles x revenue per vehicle. */
export function weeklyRevenueLost(down: Record<string, number[]>, programs: VehicleProgram[], weeks: number): number[] {
  return Array.from({ length: weeks }, (_, k) =>
    programs.reduce((s, g) => s + (down[g.id]?.[k] ?? 0) * g.dailyVehicles * (g.revenuePerVehicleMxn ?? 0), 0));
}

const totalLost = (down: Record<string, number[]>, programs: VehicleProgram[]) =>
  revenueLost(down, programs).reduce((a, r) => a + r.mxn, 0);

/** Each optimization on its own, per supplier, summed by action: revenue protected vs stock it adds (MXN). */
export function actionReturns(rows: ScenarioRow[], weeks: number, programs: VehicleProgram[], parts: Part[]) {
  const base = totalLost(downDays(rows, {}, weeks, programs, parts), programs);
  const out = new Map<string, { id: string; label: string; suppliers: number; protectedMxn: number; stockMxn: number; costed: boolean }>();
  for (const r of rows) {
    if (!actionable(r.risk, weeks)) continue;
    const acts = r.risk.scenarios?.actions ?? [];
    acts.forEach((a, i) => {
      const choice: Choice = { [r.id]: acts.map((_, j) => (j === i ? "1" : "0")).join("") };
      const saved = base - totalLost(downDays(rows, choice, weeks, programs, parts), programs);
      const cost = actionCost(rows, choice, parts);
      const e = out.get(a.id) ?? { id: a.id, label: a.label, suppliers: 0, protectedMxn: 0, stockMxn: 0, costed: STOCK_DAYS[a.id] != null };
      e.suppliers++; e.protectedMxn += saved; e.stockMxn += cost.lines.reduce((x, l) => x + l.mxn, 0);
      out.set(a.id, e);
    });
  }
  return [...out.values()].sort((a, b) => b.protectedMxn - a.protectedMxn);
}

/** If the OEM raises volume by `swing` (contract +15%): extra revenue per model over the horizon, and how much the
 *  suppliers of its critical parts can deliver (flex test). A supplier at service level s under the surge delivers
 *  (s x (1 + swing) - 1) / swing of the extra volume; the model captures the weakest supplier's share. */
export function flexUpside(rows: ScenarioRow[], weeks: number, programs: VehicleProgram[], parts: Part[], swing: number) {
  const days = weeks * 7;
  return programs.map((g) => {
    const feeding = new Set(parts.filter((p) => p.programIds?.includes(g.id) && p.criticality !== "normal").map((p) => p.supplierId));
    let share = 1;
    const blockers: { name: string; share: number; bottleneck: string }[] = [];
    for (const r of rows) {
      if (!feeding.has(r.id) || !r.risk.flex) continue;
      const s = Math.max(0, Math.min(1, (r.risk.flex.serviceLevel * (1 + swing) - 1) / swing));
      if (s < 0.999) blockers.push({ name: r.name, share: s, bottleneck: r.risk.flex.bottleneck });
      share = Math.min(share, s);
    }
    const potential = swing * g.dailyVehicles * days * (g.revenuePerVehicleMxn ?? 0);
    return { program: g, potential, captured: potential * share, share, vehicles: Math.round(swing * g.dailyVehicles * days), blockers: blockers.sort((a, b) => a.share - b.share) };
  });
}
