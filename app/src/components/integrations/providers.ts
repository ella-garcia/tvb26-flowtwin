// Systems a company can connect on the Data pages, and the status shown for each.
// Real companies show their real `connections` rows. The synthetic demo companies get a stable sample mix
// (some connected, some not, picked from the company id) so the demo looks lived-in; it never changes between loads.
import type { Connection } from "../../lib/types";
import filesLogo from "../../assets/integrations/files.png";
import logistaasLogo from "../../assets/integrations/logistaas.png";
import netsuiteLogo from "../../assets/integrations/netsuite.png";
import sapLogo from "../../assets/integrations/sap.png";

export type ProviderId = "sap" | "netsuite" | "logistaas" | "file-drop";
export interface Provider { id: ProviderId; name: string; kind: string; sends: string; logo: string }

export const PROVIDERS: Provider[] = [
  { id: "sap", name: "SAP", kind: "ERP", sends: "Stock per part, scheduling agreements and goods receipts.", logo: sapLogo },
  { id: "netsuite", name: "Oracle NetSuite", kind: "ERP", sends: "Stock per part, purchase orders and item receipts.", logo: netsuiteLogo },
  { id: "logistaas", name: "Logistaas", kind: "Logistics platform", sends: "Shipments, ETAs and freight status from your forwarders.", logo: logistaasLogo },
  { id: "file-drop", name: "Excel and CSV files", kind: "Files", sends: "Exports from any system, uploaded below.", logo: filesLogo },
];
/** Providers that need a connection set up (files always work through the uploads below). */
export const SYSTEMS: ProviderId[] = ["sap", "netsuite", "logistaas"];

export type IntegrationState =
  | { status: "connected"; syncedHoursAgo?: number; lastRunAt?: string }
  | { status: "requested"; requestedAt?: string }
  | { status: "available" };

/** FNV-1a: a small, stable hash so each demo company always gets the same mix. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Sample mix for a demo company. A key customer (Tier 1) has one or two of the three systems connected. A supplier
 *  (Tier 2, mostly SMEs with little ERP) has none in about 4 of 10 cases, one in about half, two otherwise. Never all. */
export function sampleConnected(companyId: string, kind: "customer" | "supplier" = "customer"): Set<ProviderId> {
  const h = hash(companyId);
  if (kind === "supplier") {
    const r = (h >>> 8) % 20;
    if (r < 8) return new Set();
    if (r < 18) return new Set([SYSTEMS[h % 3]]);
  }
  const first = SYSTEMS[h % 3];
  const second = (h >>> 3) % 2 === 0 ? SYSTEMS[(h % 3 + 1 + ((h >>> 5) % 2)) % 3] : undefined;
  return new Set([first, ...(second ? [second] : [])]);
}

/** Hours since the last sample sync, 1 to 11, stable per company and system. */
export function sampleSyncHours(companyId: string, provider: ProviderId): number {
  return 1 + (hash(`${companyId}:${provider}`) % 11);
}

export function integrationState(p: ProviderId, opts: {
  companyId: string; synthetic: boolean; connections: Connection[]; requested: Set<string>; kind?: "customer" | "supplier";
}): IntegrationState {
  if (p === "file-drop") return { status: "connected" };
  const row = opts.connections.find((c) => c.provider === p);
  if (row?.status === "active") return { status: "connected", lastRunAt: row.lastRunAt };
  if (row?.status === "pending" || opts.requested.has(p)) {
    return { status: "requested", requestedAt: (row?.config as { requestedAt?: string } | undefined)?.requestedAt };
  }
  if (!row && opts.synthetic && sampleConnected(opts.companyId, opts.kind).has(p)) {
    return { status: "connected", syncedHoursAgo: sampleSyncHours(opts.companyId, p) };
  }
  return { status: "available" };
}
