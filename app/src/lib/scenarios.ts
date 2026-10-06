// What-if: combine the engine's precomputed per-supplier results (risk.scenarios) for a chosen set of actions.
// No risk logic here: every weekly level comes from the engine; this file only picks combinations and counts.
import type { RiskAssessment, RiskLevel } from "./types";

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
