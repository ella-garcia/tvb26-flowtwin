import { describe, expect, it } from "vitest";
import { TRACK_DEMO, filterPair, scopeTrack, summarize } from "./trackData";

const pairs = (d: { entries: { alert: { customerId: string; supplierId: string } }[] }) =>
  new Set(d.entries.map((e) => `${e.alert.customerId}/${e.alert.supplierId}`));

describe("track record sample data, seed-mode scoping", () => {
  it("is marked as sample data", () => {
    expect(TRACK_DEMO.sample).toBe(true);
  });

  it("gives a key customer only its own suppliers' alerts and snapshots", () => {
    const d = scopeTrack(TRACK_DEMO, { role: "customer", companyId: "qss" });
    expect(d.entries.length).toBeGreaterThan(0);
    expect(d.entries.every((e) => e.alert.customerId === "qss")).toBe(true);
    expect(d.history.every((h) => h.customerId === "qss")).toBe(true);
    const other = scopeTrack(TRACK_DEMO, { role: "customer", companyId: "slp-interiors" });
    expect([...pairs(other)]).toEqual(["slp-interiors/rpo"]);
  });

  it("gives a supplier (owner or ops) only the alerts about itself, from every customer", () => {
    for (const role of ["owner", "ops"] as const) {
      const d = scopeTrack(TRACK_DEMO, { role, companyId: "hmo" });
      expect(d.entries.length).toBe(2);
      expect(d.entries.every((e) => e.alert.supplierId === "hmo")).toBe(true);
      expect(d.history.every((h) => h.supplierId === "hmo")).toBe(true);
    }
    expect([...pairs(scopeTrack(TRACK_DEMO, { role: "owner", companyId: "rpo" }))]).toEqual(["slp-interiors/rpo"]);
  });

  it("gives an admin, or a customer id used with a supplier role, nothing", () => {
    expect(scopeTrack(TRACK_DEMO, { role: "admin", companyId: "platform" }).entries).toEqual([]);
    expect(scopeTrack(TRACK_DEMO, { role: "owner", companyId: "qss" }).entries).toEqual([]);
    expect(scopeTrack(TRACK_DEMO, { role: "customer", companyId: "hmo" }).entries).toEqual([]);
  });

  it("narrows to one pair", () => {
    const d = filterPair(scopeTrack(TRACK_DEMO, { role: "customer", companyId: "qss" }), { customerId: "qss", supplierId: "tsr" });
    expect([...pairs(d)]).toEqual(["qss/tsr"]);
  });
});

describe("track record summary", () => {
  const qss = scopeTrack(TRACK_DEMO, { role: "customer", companyId: "qss" });

  it("covers at least one of each judged outcome for the demo customer", () => {
    const kinds = new Set(qss.entries.map((e) => e.outcome.outcome));
    for (const k of ["hit", "prevented", "false-alarm", "unknown"] as const) expect(kinds.has(k)).toBe(true);
  });

  it("rates (hit + prevented) / (hit + prevented + false alarm) over the last 90 days only", () => {
    const s = summarize(qss.entries, "2026-10-05");
    expect(s.since).toBe("2026-07-07");
    expect(s.entries.some((e) => e.alert.id === "alert-tsr-qss-20260618")).toBe(false); // older than 90 days
    expect(s.counts).toMatchObject({ hit: 2, prevented: 2, "false-alarm": 1, unknown: 1, pending: 1 });
    expect(s.rated).toBe(5);
    expect(s.rate).toBeCloseTo(0.8, 10);
  });

  it("has no rate when nothing is rated", () => {
    const only = qss.entries.filter((e) => e.outcome.outcome === "unknown" || e.outcome.outcome === "pending");
    const s = summarize(only, "2026-10-05");
    expect(s.rate).toBeNull();
    expect(s.counts.unknown + s.counts.pending).toBe(2);
  });
});
