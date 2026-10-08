import { describe, expect, it } from "vitest";
import seedJson from "../data/seed/seed.json";
import demoJson from "../data/performance-demo.json";
import { buildPerformance, daysLate, evenTop, receiptStats, type PerformanceInputs } from "./performance";
import { scopeExtra } from "./performanceData";
import type { Part, Receipt, RiskAssessment, RiskHistoryRow, Seed, Signal } from "./types";

const AS_OF = "2026-10-05";

const part = (id: string, supplierId: string, kw: Partial<Part> = {}): Part => ({
  id, number: id.toUpperCase(), name: id, supplierId, customerId: "qss", unitCostMxn: 1, dailyUsage: 100, onHand: 500,
  daysOfCover: 5, singleSource: false, criticality: "normal", ...kw,
});
const risk = (supplierId: string, kw: Partial<RiskAssessment> = {}): RiskAssessment => ({
  customerId: "qss", supplierId, level: "green", score: 10, normalTransitDays: 2, expectedTransitDays: 2,
  worstCaseTransitDays: 3, minCoverDays: 5, daysToLineStop: null, lineStopExposureEur: 0, drivers: [],
  flex: { demandIncrease: 0.15, canAbsorb: true, serviceLevel: 1, daysToRecover: 0, headroom: 0.2, bottleneck: "", provenance: "estimated" },
  otifTrend: [0.99, 0.98, 0.99, 1], projection: [], dataStatus: "connected", updatedAt: AS_OF, ...kw,
});
const receipt = (promised: string, received: string | undefined, ordered = 100, got = 100, kw: Partial<Receipt> = {}): Receipt => ({
  customerId: "qss", supplierId: "a", partId: "pa", poNumber: `PO-${promised}`, promisedDate: promised, receivedDate: received,
  quantityOrdered: ordered, quantityReceived: received ? got : 0, ...kw,
});
const inputs = (kw: Partial<PerformanceInputs> = {}): PerformanceInputs => ({
  asOf: AS_OF, customerId: "qss", companies: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }],
  parts: [part("pa", "a"), part("pb", "b"), part("pc", "c")], risks: [risk("a"), risk("b"), risk("c")], alerts: [], signals: [],
  receipts: [], history: [], track: null, sample: false, ...kw,
});
const kpi = (m: ReturnType<typeof buildPerformance>, id: string) => m.kpis.find((k) => k.id === id)!;
const ALL = { periodDays: 30 as const, programId: "all" };

describe("receipt rules", () => {
  it("late, short and not-received lines", () => {
    expect(daysLate(receipt("2026-10-01", "2026-10-03"), AS_OF)).toBe(2);
    expect(daysLate(receipt("2026-10-01", undefined), AS_OF)).toBe(4);   // open line counts up to today
    expect(daysLate(receipt("2026-10-06", undefined), AS_OF)).toBe(0);   // not due yet
    const s = receiptStats([receipt("2026-10-01", "2026-10-01"), receipt("2026-10-01", "2026-10-03"),
      receipt("2026-10-02", "2026-10-02", 100, 90), receipt("2026-10-01", undefined), receipt("2026-10-09", undefined)], AS_OF);
    expect(s.lines).toBe(4);                 // the line due on 9 Oct is not counted
    expect(s.otif).toBe(0.25);               // only the first is on time and in full
    expect(s.late).toBe(2);
    expect(s.avgDaysLate).toBe(3);           // (2 + 4) / 2
  });
});

describe("KPI tiles", () => {
  it("say No data yet instead of zero, and compare with the previous period", () => {
    expect(kpi(buildPerformance(inputs(), ALL), "otif").display).toBe("No data yet");
    expect(kpi(buildPerformance(inputs(), ALL), "hit-rate").value).toBeNull();
    const m = buildPerformance(inputs({ receipts: [
      receipt("2026-09-20", "2026-09-20"), receipt("2026-09-21", "2026-09-23"),   // this period: 50%
      receipt("2026-08-07", "2026-08-09"), receipt("2026-08-21", "2026-08-24"),   // previous period (from 7 Aug): 0%
    ] }), ALL);
    const otif = kpi(m, "otif");
    expect(otif.value).toBe(0.5);
    expect(otif.delta?.improved).toBe(true);
    expect(otif.delta?.display).toContain("▲");
    expect(kpi(m, "days-late").value).toBe(2);
    expect(kpi(m, "days-late").delta?.improved).toBe(true);   // 2.5 days late before, 2 now
  });

  it("do not compare with a previous period the receipts only partly cover", () => {
    const m = buildPerformance(inputs({ receipts: [receipt("2026-09-20", "2026-09-20"), receipt("2026-09-01", "2026-09-01")] }), ALL);
    expect(m.period.previousFrom).toBe("2026-08-07");
    expect(kpi(m, "otif").delta).toBeUndefined();
  });

  it("count red suppliers against the snapshot a week ago, and the soonest stop", () => {
    const history: RiskHistoryRow[] = ["a", "b", "c"].map((s) => ({ customerId: "qss", supplierId: s, asOf: "2026-09-28", level: "green", score: 10 }));
    const m = buildPerformance(inputs({ history, risks: [risk("a", { level: "red", score: 80, daysToLineStop: 3 }),
      risk("b", { level: "red", score: 70, daysToLineStop: 2 }), risk("c")] }), ALL);
    expect(kpi(m, "act-now").value).toBe(2);
    expect(kpi(m, "act-now").delta).toMatchObject({ value: 2, improved: false, vs: "7 days ago" });
    expect(kpi(m, "soonest-stop").display).toBe("2 days");
    expect(kpi(buildPerformance(inputs(), ALL), "soonest-stop").display).toBe("None in 14 days");
  });
});

describe("supplier panels", () => {
  it("rank like the risk board: days to line stop, then the most critical short part, then score", () => {
    const m = buildPerformance(inputs({
      parts: [part("pa", "a", { daysOfCover: 1, criticality: "normal" }), part("pb", "b", { daysOfCover: 1, criticality: "line-stopper" }),
        part("pc", "c")],
      risks: [risk("a", { score: 60, expectedTransitDays: 3 }), risk("b", { score: 40, expectedTransitDays: 3 }),
        risk("c", { score: 90, daysToLineStop: 4 })],
    }), ALL);
    expect(m.suppliers.map((s) => s.supplierId)).toEqual(["c", "b", "a"]);
    const b = m.suppliers[1];
    expect(b.parts[0]).toMatchObject({ coverDays: 1, transitDays: 3, short: true, criticality: "line-stopper" });
    expect(b.otif.grade).toBe("A");
    expect(b.levelWord).toBe("OK");
  });
});

describe("disruptions donut", () => {
  it("counts each supplier once per kind, skips disabled signals, and reports distinct suppliers", () => {
    const signals = [{ id: "s1", kind: "weather" }, { id: "s2", kind: "customs" }, { id: "s3", kind: "road", active: false }] as Signal[];
    const m = buildPerformance(inputs({ signals, risks: [
      risk("a", { drivers: [{ label: "", kind: "weather", signalId: "s1", contribution: 10 }, { label: "", kind: "customs", signalId: "s2", contribution: 5 }] }),
      risk("b", { drivers: [{ label: "", kind: "weather", signalId: "s1", contribution: 8 }, { label: "", kind: "cover", contribution: 4 }] }),
      risk("c", { drivers: [{ label: "", kind: "road", signalId: "s3", contribution: 8 }] }),
    ] }), ALL);
    expect(m.disruptions.affected).toBe(2);
    expect(m.disruptions.slices).toEqual([
      { kind: "weather", label: "Weather", suppliers: 2, share: 1 },
      { kind: "customs", label: "Customs", suppliers: 1, share: 0.5 },
    ]);
  });
});

describe("deliveries by month", () => {
  it("adds quantities as days of usage across parts in different units", () => {
    const m = buildPerformance(inputs({
      parts: [part("pa", "a", { dailyUsage: 100 }), part("kg", "a", { dailyUsage: 2000 })],
      receipts: [receipt("2026-09-10", "2026-09-10", 500, 400), receipt("2026-09-12", "2026-09-12", 10000, 10000, { partId: "kg" }),
        receipt("2026-09-14", "2026-09-14", 50, 50, { partId: undefined })],
    }), { periodDays: 90, programId: "all" });
    const sep = m.deliveries.find((d) => d.month === "2026-09")!;
    expect(sep).toMatchObject({ orderedDays: 10, receivedDays: 9, shortDays: 1, lines: 3, lateLines: 0 });
    expect(m.deliveries.map((d) => d.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
  });
});

describe("daily trend", () => {
  it("leaves gaps for days without a snapshot and flags the worst and best days", () => {
    const h = (asOf: string, score: number): RiskHistoryRow => ({ customerId: "qss", supplierId: "a", asOf, level: score >= 65 ? "red" : "green", score });
    const m = buildPerformance(inputs({ history: [h("2026-10-05", 80), h("2026-10-03", 20), h("2026-10-04", 50)] }), ALL);
    expect(m.trend).toHaveLength(31);
    expect(m.trend[0]).toMatchObject({ date: "2026-09-05", red: null, avgScore: null });
    expect(m.trend.at(-1)).toMatchObject({ date: AS_OF, red: 1, avgScore: 80, flag: "max" });
    expect(m.trend.find((d) => d.date === "2026-10-03")?.flag).toBe("min");
  });
});

describe("programme filter", () => {
  it("keeps only the model's parts, their suppliers and their receipts", () => {
    const m = buildPerformance(inputs({
      parts: [part("pa", "a", { programIds: ["k3"] }), part("pb", "b", { programIds: ["m5"] }), part("pc", "c")],
      receipts: [receipt("2026-09-20", "2026-09-20"), receipt("2026-09-20", "2026-09-25", 100, 100, { supplierId: "b", partId: "pb" })],
    }), { periodDays: 30, programId: "k3" });
    expect(m.suppliers.map((s) => s.supplierId)).toEqual(["a"]);
    expect(kpi(m, "otif").value).toBe(1);
  });
});

describe("sample data", () => {
  const seed = seedJson as unknown as Seed;
  const demo = demoJson as unknown as { receipts: Receipt[]; history: RiskHistoryRow[]; sample: boolean };
  const extra = scopeExtra({ ...demo, sample: true }, { role: "customer", companyId: "qss" }, seed.asOf);
  const model = buildPerformance({
    asOf: seed.asOf, customerId: "qss", companies: seed.companies, parts: seed.parts, risks: seed.risks, alerts: seed.alerts,
    signals: seed.signals, receipts: extra.receipts, history: extra.history, track: null, sample: true,
  }, { periodDays: 180, programId: "all" });

  it("has no money fields and only known parts", () => {
    const ids = new Set(seed.parts.map((p) => p.id));
    for (const r of demo.receipts) {
      expect(Object.keys(r).some((k) => /price|cost|amount|total|mxn|eur/i.test(k))).toBe(false);
      expect(ids.has(r.partId!)).toBe(true);
    }
  });

  it("tells the demo story: Orizaba worst on time, a red supplier today, history ending on today's levels", () => {
    expect(extra.receipts.every((r) => r.customerId === "qss")).toBe(true);
    const late = (sup: string) => receiptStats(extra.receipts.filter((r) => r.supplierId === sup && r.promisedDate >= "2026-09-01"), seed.asOf);
    expect(late("hmo").otif!).toBeLessThan(late("edl").otif!);
    expect(kpi(model, "act-now").value).toBe(1);
    expect(model.suppliers[0].supplierId).toBe("hmo");
    expect(model.deliveries).toHaveLength(6);
    expect(model.trend.at(-1)?.red).toBe(1);
    const otif = kpi(model, "otif").value!;
    expect(otif).toBeGreaterThan(0.85);
    expect(otif).toBeLessThan(0.99);
  });
});

describe("evenTop", () => {
  it("gives an axis top with three even, round ticks", () => {
    expect(evenTop(11)).toBe(12);
    expect(evenTop(9)).toBe(10);
    expect(evenTop(4)).toBe(4);
    expect(evenTop(23)).toBe(24);
  });
});
