import { describe, expect, it } from "vitest";
import { circularityScore } from "./circularity";
import type { CircularSummary } from "./types";

const full: CircularSummary = { year: 2026, scrapRoute: "mill-return", recycledContentPct: 0.5, returnablePackagingPct: 0.5, renewableElectricityPct: 0.5, iso14001: true, provenance: "estimated" };

describe("circularity score", () => {
  it("averages the five fields with equal weights", () => {
    const c = circularityScore(full);
    expect(c.components).toHaveLength(5);
    expect(c.score).toBe(Math.round(100 * (1 + 0.5 + 0.5 + 0.5 + 1) / 5));
    expect(c.missing).toEqual([]);
  });
  it("scores scrap routes as specified", () => {
    const s = (scrapRoute: CircularSummary["scrapRoute"]) => circularityScore({ ...full, scrapRoute }).components[0].value;
    expect([s("landfill"), s("unknown"), s("recycler"), s("mill-return"), s("internal-remelt")]).toEqual([0, 0.2, 0.7, 1, 1]);
  });
  it("skips fields left blank and lists them as missing", () => {
    const c = circularityScore({ ...full, recycledContentPct: undefined, renewableElectricityPct: undefined, iso14001: false });
    expect(c.missing).toEqual(["Recycled content", "Renewable electricity"]);
    expect(c.components).toHaveLength(3);
    expect(c.score).toBe(Math.round(100 * (1 + 0.5 + 0) / 3));
  });
  it("stays within 0..100", () => {
    expect(circularityScore({ ...full, scrapRoute: "landfill", recycledContentPct: 0, returnablePackagingPct: 0, renewableElectricityPct: 0, iso14001: false }).score).toBe(0);
    expect(circularityScore({ ...full, recycledContentPct: 1, returnablePackagingPct: 1, renewableElectricityPct: 1 }).score).toBe(100);
  });
});
