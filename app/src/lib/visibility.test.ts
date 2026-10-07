import { describe, expect, it } from "vitest";
import seedJson from "../data/seed/seed.json";
import { VISIBILITY_WEIGHTS, visibilityIndex, visibilityWord } from "./visibility";
import type { Seed } from "./types";

const seed = seedJson as unknown as Seed;
const risks = seed.risks.filter((r) => r.customerId === "qss");

describe("visibility index (qss seed)", () => {
  const all = risks.map((r) => ({ r, v: visibilityIndex(r, seed.parts, seed.alerts) }));
  it("has weights that sum to 1", () => {
    expect(Object.values(VISIBILITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it("keeps every part in 0..1 and the index in 0..100", () => {
    expect(all.length).toBeGreaterThan(0);
    for (const { v } of all) {
      for (const p of [v.sensing, v.learning, v.coordinating]) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
      expect(v.index).toBeGreaterThanOrEqual(0); expect(v.index).toBeLessThanOrEqual(100);
      expect(v.parts).toHaveLength(3);
    }
  });
  it("rates a connected supplier above a public-only one with the same history", () => {
    const base = risks[0];
    const a = visibilityIndex({ ...base, dataStatus: "connected" }, [], []);
    const b = visibilityIndex({ ...base, dataStatus: "public-only" }, [], []);
    expect(a.index).toBeGreaterThan(b.index);
  });
  it("uses a neutral 0.5 for coordinating when there are no alerts, and counts answers otherwise", () => {
    const r = risks[0];
    expect(visibilityIndex(r, [], []).coordinating).toBe(0.5);
    const mk = (answered: boolean) => ({ ...seed.alerts[0], customerId: r.customerId, supplierId: r.supplierId,
      supplierResponse: answered ? { by: "x", at: "2026-10-01", message: "ok", confirmedCapacity: true } : undefined });
    expect(visibilityIndex(r, [], [mk(true), mk(false)]).coordinating).toBe(0.5);
    expect(visibilityIndex(r, [], [mk(true)]).coordinating).toBe(1);
    expect(visibilityIndex(r, [], [mk(false)]).coordinating).toBe(0);
  });
  it("matches the formula by hand for one supplier", () => {
    const r = risks[0], v = visibilityIndex(r, seed.parts, seed.alerts);
    const w = VISIBILITY_WEIGHTS;
    expect(v.index).toBe(Math.round(100 * (w.sensing * v.sensing + w.learning * v.learning + w.coordinating * v.coordinating)));
  });
  it("words: High at 70, Medium at 40, Low below", () => {
    expect([visibilityWord(70), visibilityWord(69), visibilityWord(40), visibilityWord(39)]).toEqual(["High", "Medium", "Medium", "Low"]);
  });
});
