import { describe, expect, it } from "vitest";
import seedJson from "../data/seed/seed.json";
import { industryScore, structuralFlags, type SupplierContext } from "./industry";
import { everyone, score, type ScenarioRow } from "./scenarios";
import type { Seed } from "./types";

const seed = seedJson as unknown as Seed;
const rows: ScenarioRow[] = seed.risks.filter((r) => r.customerId === "qss")
  .map((risk) => ({ id: risk.supplierId, name: seed.companies.find((c) => c.id === risk.supplierId)!.name, risk }));
const ctx = new Map<string, SupplierContext>(rows.map((r) => [r.id, {
  parts: seed.parts.filter((p) => p.supplierId === r.id && p.customerId === "qss"),
  shareOfSales: seed.relationships.find((x) => x.supplierId === r.id && x.customerId === "qss")?.shareOfSales,
  otifTarget: 0.98,
}]));

describe("industry view", () => {
  const all = everyone(rows, 12, true);
  const ind = industryScore(rows, all, 12, ctx);
  const op = { before: score(rows, {}, 12), after: score(rows, all, 12) };
  console.log("operational", op, "industry", { before: ind.before, after: ind.after, range: ind.range, capBefore: ind.beforeCapBy, capAfter: ind.afterCapBy });
  console.log(ind.flagged.map((f) => `${f.name}: ${f.flags.join("; ")}`).join("\n"));

  it("is stricter than the operational score", () => {
    expect(ind.before).toBeLessThan(op.before);
    expect(ind.after).toBeLessThan(op.after);
  });
  it("caps the no-action score at Poor while a line stop is expected (Orizaba)", () => {
    expect(ind.beforeCapped).toBe(true);
    expect(ind.before).toBeLessThanOrEqual(59);
    expect(ind.beforeCapBy).toContain("Hules y Mangueras de Orizaba");
  });
  it("gives a range from nothing working to everything working", () => {
    expect(ind.range.low).toBe(ind.before);
    expect(ind.range.low).toBeLessThanOrEqual(ind.after);
    expect(ind.after).toBeLessThanOrEqual(ind.range.high);
  });
  it("flags Estampados del Laja even though its outlook is all OK", () => {
    const edl = rows.find((r) => r.id === "edl")!;
    expect(structuralFlags(edl, ctx.get("edl")).length).toBeGreaterThanOrEqual(3);
  });
});
