import { describe, expect, it } from "vitest";
import seedJson from "../../data/seed/seed.json";
import { integrationState, sampleConnected, sampleSyncHours } from "./providers";
import type { Connection, Seed } from "../../lib/types";

const seed = seedJson as unknown as Seed;
const opts = (companyId: string, kw: Partial<{ synthetic: boolean; connections: Connection[]; requested: Set<string> }> = {}) =>
  ({ companyId, synthetic: true, connections: [], requested: new Set<string>(), ...kw });

describe("sample integrations", () => {
  it("connect one or two systems for a key customer, up to two for a supplier, the same every time", () => {
    for (const c of seed.companies) {
      const s = sampleConnected(c.id, c.kind);
      expect(s.size).toBeGreaterThanOrEqual(c.kind === "customer" ? 1 : 0);
      expect(s.size).toBeLessThanOrEqual(2);
      expect([...sampleConnected(c.id, c.kind)]).toEqual([...s]);
      expect(sampleSyncHours(c.id, "sap")).toBeGreaterThanOrEqual(1);
      expect(sampleSyncHours(c.id, "sap")).toBeLessThanOrEqual(11);
    }
  });

  it("leave some suppliers on files only, like most Tier 2 SMEs", () => {
    const suppliers = seed.companies.filter((c) => c.kind === "supplier");
    const none = suppliers.filter((c) => sampleConnected(c.id, "supplier").size === 0).length;
    expect(none).toBeGreaterThan(0);
    expect(none).toBeLessThan(suppliers.length);
  });

  it("vary across companies, so the demo does not look identical everywhere", () => {
    const mixes = new Set(seed.companies.map((c) => [...sampleConnected(c.id)].sort().join(",")));
    expect(mixes.size).toBeGreaterThan(2);
  });
});

describe("integrationState", () => {
  it("files always work", () => {
    expect(integrationState("file-drop", opts("qss", { synthetic: false })).status).toBe("connected");
  });
  it("real companies never get sample connections", () => {
    for (const p of ["sap", "netsuite", "logistaas"] as const) {
      expect(integrationState(p, opts("acme", { synthetic: false })).status).toBe("available");
    }
  });
  it("database rows win over the sample, and a request shows as requested", () => {
    const sampled = [...sampleConnected("qss")][0];
    const row = { id: "x", companyId: "qss", kind: "erp", provider: sampled, status: "pending", config: { requestedAt: "2026-10-08T10:00:00Z" }, createdAt: "" } as Connection;
    expect(integrationState(sampled, opts("qss", { connections: [row] }))).toEqual({ status: "requested", requestedAt: "2026-10-08T10:00:00Z" });
    expect(integrationState(sampled, opts("qss", { connections: [{ ...row, status: "active", lastRunAt: "2026-10-08T09:00:00Z" }] })))
      .toEqual({ status: "connected", lastRunAt: "2026-10-08T09:00:00Z" });
    const free = (["sap", "netsuite", "logistaas"] as const).find((p) => !sampleConnected("qss").has(p))!;
    expect(integrationState(free, opts("qss")).status).toBe("available");
    expect(integrationState(free, opts("qss", { requested: new Set([free]) })).status).toBe("requested");
  });
});
