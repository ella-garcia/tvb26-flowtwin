// Aggregations for the Sustainability page. Pure: the engine computes the per-pair footprint (risk.circular) and the
// per-week short days (risk.scenarios); this file only adds them up. Physical units only (km, trucks, kg CO2e). No money.
import { levelsFor, noneKey, weekOf, type Choice, type ScenarioRow } from "./scenarios";
import type { Company, Provenance, RiskAssessment } from "./types";

export interface FootprintRow {
  id: string; name: string; place: string;
  roadKm: number; trucksPerWeek: number; palletsPerWeek: number; fill: number;
  truckKmPerWeek: number; co2eKgPerWeek: number; provenance: Provenance;
  expediteKmPerShortDay: number; expediteCo2ePerShortDayKg: number;
}

/** One row per supplier whose risk carries a footprint, biggest CO2e first. Risks without one are counted in `footprintTotals().missing`. */
export function footprintRows(risks: RiskAssessment[], companies: Company[]): FootprintRow[] {
  const byId = new Map(companies.map((c) => [c.id, c]));
  return risks.filter((r) => r.circular).map((r) => {
    const c = r.circular!, co = byId.get(r.supplierId);
    return {
      id: r.supplierId, name: co?.name ?? r.supplierId, place: co ? `${co.city}, ${co.state}` : "",
      roadKm: c.roadKm, trucksPerWeek: c.trucksPerWeek, palletsPerWeek: c.palletsPerWeek, fill: c.fillRate,
      truckKmPerWeek: c.truckKmPerWeek, co2eKgPerWeek: c.co2ePerWeekKg, provenance: c.provenance,
      expediteKmPerShortDay: c.expediteKmPerShortDay, expediteCo2ePerShortDayKg: c.expediteCo2ePerShortDayKg,
    };
  }).sort((a, b) => b.co2eKgPerWeek - a.co2eKgPerWeek || a.name.localeCompare(b.name));
}

export interface FootprintTotals { suppliers: number; truckKmPerWeek: number; trucksPerWeek: number; avgFill: number; co2eKgPerWeek: number; provenance: Provenance }

/** Average fill is weighted by trucks, so it equals total pallets ÷ total truck capacity. */
export function footprintTotals(rows: FootprintRow[]): FootprintTotals {
  const trucks = rows.reduce((a, r) => a + r.trucksPerWeek, 0);
  return {
    suppliers: rows.length, trucksPerWeek: trucks,
    truckKmPerWeek: rows.reduce((a, r) => a + r.truckKmPerWeek, 0),
    co2eKgPerWeek: rows.reduce((a, r) => a + r.co2eKgPerWeek, 0),
    avgFill: trucks ? rows.reduce((a, r) => a + r.fill * r.trucksPerWeek, 0) / trucks : 0,
    provenance: rows.some((r) => r.provenance === "estimated") || rows.length === 0 ? "estimated" : "measured",
  };
}

const tonnes = (kg: number) => kg / 1000;
export const toTonnes = tonnes;

/** Line-down days per week in the horizon for a combo key (the engine's shortDays, via lib/scenarios.ts). */
function shortDaysFor(r: RiskAssessment, key: string | undefined, weeks: number): number[] {
  const res = weekOf(r, key);
  if (res) return res.slice(0, weeks).map((w) => w.shortDays ?? 0);
  return levelsFor(r, key, weeks).map(() => 0);
}

/** Weeks in the horizon where an action is actually in use: switching it off (same other choices) changes that
 *  week's expected delay. An alternative route is only driven while the disruption it avoids is there. */
function weeksInUse(r: RiskAssessment, key: string, actionIndex: number, weeks: number): number {
  if (key[actionIndex] !== "1") return 0;
  const off = key.slice(0, actionIndex) + "0" + key.slice(actionIndex + 1);
  const on = weekOf(r, key)?.slice(0, weeks) ?? [], without = weekOf(r, off)?.slice(0, weeks) ?? [];
  return on.reduce((n, w, k) => n + (Math.abs((without[k]?.extraDays ?? w.extraDays) - w.extraDays) > 1e-9 ? 1 : 0), 0);
}

export interface PaysTwiceRow {
  id: string; name: string;
  daysAvoided: number;                 // line-down days avoided vs no action
  expediteKmAvoided: number; expediteCo2eKgAvoided: number;
  extraKm: number; extraCo2eKg: number; // from actions with a km factor (alternative route), while in place
}
export interface PaysTwice {
  rows: PaysTwiceRow[];
  daysAvoided: number; expediteKmAvoided: number; expediteCo2eKgAvoided: number;
  extraKm: number; extraCo2eKg: number;
  netKm: number; netCo2eKg: number;    // avoided minus added
}

/** Compare the chosen scenario with "no one acts". Every line-down day avoided also avoids the expedited freight that
 *  usually follows (engine: expedite km and CO2e per short day). Actions with a kmFactor (alternative route) add
 *  (factor - 1) x truck-km per week, only in the weeks they are in use (see weeksInUse). */
export function resiliencePaysTwice(rows: FootprintRow[], choice: Choice, weeks: number, risks: ScenarioRow[]): PaysTwice {
  const fp = new Map(rows.map((r) => [r.id, r]));
  const out: PaysTwiceRow[] = [];
  for (const s of risks) {
    const f = fp.get(s.id);
    if (!f) continue;
    const key = choice[s.id] ?? noneKey(s.risk);
    const before = shortDaysFor(s.risk, undefined, weeks), after = shortDaysFor(s.risk, key, weeks);
    const daysAvoided = before.reduce((a, d, k) => a + Math.max(0, d - (after[k] ?? 0)), 0);
    const extraKm = (s.risk.scenarios?.actions ?? []).reduce((km, a, i) =>
      (a.kmFactor && a.kmFactor > 1 ? km + weeksInUse(s.risk, key, i, weeks) * (a.kmFactor - 1) * f.truckKmPerWeek : km), 0);
    const kgPerKm = f.truckKmPerWeek ? f.co2eKgPerWeek / f.truckKmPerWeek : 0;
    out.push({
      id: s.id, name: s.name, daysAvoided,
      expediteKmAvoided: daysAvoided * f.expediteKmPerShortDay, expediteCo2eKgAvoided: daysAvoided * f.expediteCo2ePerShortDayKg,
      extraKm, extraCo2eKg: extraKm * kgPerKm,
    });
  }
  const sum = (k: keyof Omit<PaysTwiceRow, "id" | "name">) => out.reduce((a, r) => a + r[k], 0);
  const t = {
    daysAvoided: sum("daysAvoided"), expediteKmAvoided: sum("expediteKmAvoided"), expediteCo2eKgAvoided: sum("expediteCo2eKgAvoided"),
    extraKm: sum("extraKm"), extraCo2eKg: sum("extraCo2eKg"),
  };
  return { rows: out.sort((a, b) => b.expediteCo2eKgAvoided - a.expediteCo2eKgAvoided || a.name.localeCompare(b.name)), ...t,
    netKm: t.expediteKmAvoided - t.extraKm, netCo2eKg: t.expediteCo2eKgAvoided - t.extraCo2eKg };
}
