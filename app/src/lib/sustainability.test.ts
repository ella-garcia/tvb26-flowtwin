import { describe, expect, it } from "vitest";
import seedJson from "../data/seed/seed.json";
import { footprintRows, footprintTotals, resiliencePaysTwice } from "./sustainability";
import { allKey, everyone, noneKey, weekOf, type ScenarioRow } from "./scenarios";
import type { RiskAssessment, Seed, TransportFootprint } from "./types";

const seed = seedJson as unknown as Seed;

// The engine fills risk.circular and ScenarioAction.kmFactor. Where the seed does not carry them yet, add a fixed
// footprint so the aggregation can be tested on the real qss risks either way.
const fake = (_r: RiskAssessment, i: number): TransportFootprint => ({
  roadKm: 200 + 10 * i, trucksPerWeek: 4, palletsPerWeek: 60, fillRate: 60 / (4 * 24), truckKmPerWeek: 4 * 2 * (200 + 10 * i),
  co2ePerWeekKg: 4 * 2 * (200 + 10 * i) * 0.9, expediteKmPerShortDay: 2 * (200 + 10 * i), expediteCo2ePerShortDayKg: 2 * (200 + 10 * i) * 0.9,
  factorId: "ef-road-artic", factorVersion: 1, provenance: "estimated",
});
const risks: RiskAssessment[] = seed.risks.filter((r) => r.customerId === "qss").map((r, i) => ({
  ...r, circular: r.circular ?? fake(r, i),
  scenarios: r.scenarios && { ...r.scenarios, actions: r.scenarios.actions.map((a) => (a.id === "alt_route" && a.kmFactor == null ? { ...a, kmFactor: 1.15 } : a)) },
}));
const rows: ScenarioRow[] = risks.map((risk) => ({ id: risk.supplierId, name: seed.companies.find((c) => c.id === risk.supplierId)?.name ?? risk.supplierId, risk }));

describe("footprint (qss)", () => {
  const fr = footprintRows(risks, seed.companies);
  const t = footprintTotals(fr);
  it("has one row per supplier, sorted by CO2e desc", () => {
    expect(fr).toHaveLength(risks.length);
    for (let i = 1; i < fr.length; i++) expect(fr[i - 1].co2eKgPerWeek).toBeGreaterThanOrEqual(fr[i].co2eKgPerWeek);
  });
  it("totals add up and fill is weighted by trucks", () => {
    expect(t.truckKmPerWeek).toBeCloseTo(fr.reduce((a, r) => a + r.truckKmPerWeek, 0));
    expect(t.trucksPerWeek).toBe(fr.reduce((a, r) => a + r.trucksPerWeek, 0));
    expect(t.avgFill).toBeGreaterThan(0); expect(t.avgFill).toBeLessThanOrEqual(1);
  });
  it("skips risks without a footprint", () => {
    expect(footprintRows([{ ...risks[0], circular: undefined }], seed.companies)).toEqual([]);
    expect(footprintTotals([]).avgFill).toBe(0);
  });
});

describe("resilience pays twice (qss)", () => {
  const fr = footprintRows(risks, seed.companies);
  const none = Object.fromEntries(rows.map((r) => [r.id, noneKey(r.risk)]));
  it("avoids nothing when no one acts", () => {
    const p = resiliencePaysTwice(fr, none, 12, rows);
    expect(p.daysAvoided).toBe(0); expect(p.expediteKmAvoided).toBe(0); expect(p.extraKm).toBe(0);
  });
  it("avoids expedite km in proportion to the short days avoided when all adopt", () => {
    const p = resiliencePaysTwice(fr, everyone(rows, 12, true), 12, rows);
    expect(p.daysAvoided).toBeGreaterThan(0);
    const byId = new Map(fr.map((r) => [r.id, r]));
    const km = p.rows.reduce((a, r) => a + r.daysAvoided * byId.get(r.id)!.expediteKmPerShortDay, 0);
    expect(p.expediteKmAvoided).toBeCloseTo(km);
    expect(p.expediteCo2eKgAvoided).toBeGreaterThan(0);
    expect(p.netKm).toBeCloseTo(p.expediteKmAvoided - p.extraKm);
  });
  it("adds km for a chosen alternative route only in the weeks it is used: (factor - 1) x truck-km per week x weeks in use", () => {
    const r = rows.find((x) => x.risk.scenarios?.actions.some((a) => a.id === "alt_route"))!;
    const i = r.risk.scenarios!.actions.findIndex((a) => a.id === "alt_route");
    const key = noneKey(r.risk).split(""); key[i] = "1";
    const p = resiliencePaysTwice(fr, { ...none, [r.id]: key.join("") }, 12, rows);
    const f = fr.find((x) => x.id === r.id)!;
    const factor = r.risk.scenarios!.actions[i].kmFactor!;
    // Weeks in use = weeks where switching the route off changes the expected delay.
    const on = weekOf(r.risk, key.join(""))!.slice(0, 12), off = weekOf(r.risk, noneKey(r.risk))!.slice(0, 12);
    const inUse = on.filter((w, k) => Math.abs(off[k].extraDays - w.extraDays) > 1e-9).length;
    expect(inUse).toBeGreaterThan(0);
    expect(inUse).toBeLessThan(12);   // the route is not driven all quarter
    expect(p.extraKm).toBeCloseTo(inUse * (factor - 1) * f.truckKmPerWeek);
    expect(p.extraCo2eKg).toBeCloseTo(p.extraKm * (f.co2eKgPerWeek / f.truckKmPerWeek));
    expect(allKey(r.risk).length).toBeGreaterThan(0);
  });
});
