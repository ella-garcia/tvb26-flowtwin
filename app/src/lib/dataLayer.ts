// The data layer. ALL reads go through `scope(state, viewer)`, which enforces who may see what.
// Rule: a key customer sees risks, alerts and parts for its own suppliers; operating data
// (machines, partners, uploads, customer relationships) is readable only by the company that owns it.
import type {
  Company, CustomerRelationship, Machine, Partner, RoleId, Seed, UploadRecord,
  Alert, Invite, Part, RiskAssessment, Signal, VehicleProgram,
  CircularProfile, CircularSummary, ConsolidationPlan, DataRequest, EmissionFactor, Share,
} from "./types";

export class AccessDeniedError extends Error {
  constructor(what: string) {
    super(`Not shared with you: ${what}. Only the supplier can see this, and it can never be shared.`);
    this.name = "AccessDeniedError";
  }
}

export interface Viewer { role: RoleId; companyId: string }

/** Mutable demo state: the seed plus anything changed while testing. */
export interface AppData extends Seed {}

export function scope(data: AppData, viewer: Viewer) {
  // Only the owner and ops roles of the same company may read its operating data.
  const own = (companyId: string, what: string) => {
    const allowed = (viewer.role === "owner" || viewer.role === "ops") && viewer.companyId === companyId;
    if (!allowed) throw new AccessDeniedError(what);
  };
  const canSeeRisk = (customerId: string, supplierId: string) =>
    (viewer.role === "customer" && viewer.companyId === customerId) ||
    ((viewer.role === "owner" || viewer.role === "ops") && viewer.companyId === supplierId);
  const byCompany = <T extends { companyId: string }>(rows: T[], companyId: string, what: string) => {
    own(companyId, what);
    return rows.filter((r) => r.companyId === companyId);
  };

  return {
    viewer,
    asOf: data.asOf,

    // ---- Public directory (names, places, segments) ----
    companies: (): Company[] => data.companies,
    company: (id: string): Company | undefined => data.companies.find((c) => c.id === id),

    // ---- Own company only (owner / ops) ----
    partners: (companyId: string): Partner[] => byCompany(data.partners, companyId, "suppliers and customers"),
    machines: (companyId: string): Machine[] => byCompany(data.machines, companyId, "machines"),
    uploads: (companyId: string): UploadRecord[] => byCompany(data.uploads, companyId, "uploads"),
    /** A supplier's relationships with its customers (own company only). */
    customersOf: (supplierId: string): CustomerRelationship[] => {
      own(supplierId, "customer relationships");
      return data.relationships.filter((r) => r.supplierId === supplierId);
    },

    // ---- Key customer ----
    /** For a key customer: its suppliers on the platform, with public metadata only. */
    suppliersOf: (customerId: string) => {
      if (viewer.role !== "customer" || viewer.companyId !== customerId) throw new AccessDeniedError("supplier list");
      return data.relationships.filter((r) => r.customerId === customerId)
        .map((r) => ({ company: data.companies.find((c) => c.id === r.supplierId)!, chainPosition: r.chainPosition, requirements: r.requirements, shareOfSales: r.shareOfSales }))
        .filter((x) => x.company);
    },

    // ---- Early warning ----
    // A key customer reads risks, alerts and parts for its own suppliers.
    // A supplier (owner / ops) reads the SAME risk and alerts about itself: "what my customer sees".
    risks: (): RiskAssessment[] => data.risks.filter((r) => canSeeRisk(r.customerId, r.supplierId)),
    risk: (customerId: string, supplierId: string): RiskAssessment | undefined => {
      if (!canSeeRisk(customerId, supplierId)) throw new AccessDeniedError("this supplier's risk assessment");
      return data.risks.find((r) => r.customerId === customerId && r.supplierId === supplierId);
    },
    alerts: (): Alert[] => data.alerts.filter((a) => canSeeRisk(a.customerId, a.supplierId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    parts: (): Part[] => data.parts.filter((p) => canSeeRisk(p.customerId, p.supplierId)),
    /** Vehicle programmes: a key customer sees its own; a supplier sees the ones its parts go into. */
    programs: (): VehicleProgram[] => (data.programs ?? []).filter((g) =>
      viewer.role === "admin" || (viewer.role === "customer" && g.customerId === viewer.companyId)
      || data.parts.some((p) => p.supplierId === viewer.companyId && p.programIds?.includes(g.id))),
    invites: (): Invite[] => {
      if (viewer.role !== "customer") throw new AccessDeniedError("supplier invitations");
      return data.invites.filter((i) => i.customerId === viewer.companyId);
    },
    signals: (): Signal[] => data.signals,
    settings: () => data.settings,

    // ---- Circular and sustainability ----
    emissionFactors: (): EmissionFactor[] => data.emissionFactors ?? [],
    /** Latest version of an emission factor (the library is public). */
    factor: (id: string): EmissionFactor | undefined =>
      (data.emissionFactors ?? []).filter((f) => f.id === id).sort((a, b) => b.version - a.version)[0],
    /** A key customer's load-consolidation plan (its own only: built from its own demand). */
    consolidationPlan: (customerId: string): ConsolidationPlan | undefined => {
      if (viewer.role !== "customer" || viewer.companyId !== customerId) throw new AccessDeniedError("load-consolidation plan");
      return (data.consolidationPlans ?? []).find((p) => p.customerId === customerId);
    },
    /** A supplier's own circular profiles (owner / ops only). A customer only ever sees a shared summary. */
    circularProfiles: (companyId: string): CircularProfile[] =>
      byCompany(data.circularProfiles ?? [], companyId, "circular practices (shared only as a summary, by consent)"),
    /** Requests the viewer sent (key customer) or received (supplier). */
    requests: (): DataRequest[] => (data.requests ?? []).filter((r) =>
      viewer.role === "customer" ? r.fromCompanyId === viewer.companyId
        : (viewer.role === "owner" || viewer.role === "ops") && r.toCompanyId === viewer.companyId),
    /** Active shares: what a supplier shared, or what was shared with a key customer. Revoked ones disappear. */
    shares: (): Share[] => (data.shares ?? []).filter((x) => !x.revoked && (
      viewer.role === "customer" ? x.customerId === viewer.companyId
        : (viewer.role === "owner" || viewer.role === "ops") && x.supplierId === viewer.companyId)),
  };
}

export type Scope = ReturnType<typeof scope>;

// ---- Mutations (pure; the store applies them) ----
export type Action =
  | { type: "record-upload"; upload: UploadRecord }
  | { type: "acknowledge-alert"; id: string; actionId?: string }
  | { type: "respond-alert"; id: string; response: NonNullable<Alert["supplierResponse"]> }
  | { type: "resolve-alert"; id: string }
  | { type: "send-invite"; invite: Invite }
  | { type: "save-circular-profile"; profile: CircularProfile }
  /** Key customer asks a supplier for its circular summary. */
  | { type: "request-circular"; request: DataRequest }
  /** Key customer asks a supplier to connect its systems (one open request per pair). */
  | { type: "request-supplier-connection"; request: DataRequest }
  /** Supplier asked for a system: its customers' open "connect your systems" requests are answered. */
  | { type: "answer-connection-requests"; supplierId: string }
  /** Supplier owner shares a frozen circular summary with one customer (replaces earlier versions). */
  | { type: "share-circular"; supplierId: string; customerId: string; summary: CircularSummary; approvedBy: string; approvedAt: string; requestId?: string }
  | { type: "revoke-share"; id: string }
  | { type: "reset"; seed: Seed };

export function reduce(data: AppData, a: Action): AppData {
  switch (a.type) {
    case "record-upload": {
      const rest = data.uploads.filter((u) => !(u.companyId === a.upload.companyId && u.kind === a.upload.kind));
      return { ...data, uploads: [...rest, a.upload] };
    }
    case "acknowledge-alert": return { ...data, alerts: data.alerts.map((x) => x.id === a.id
      ? { ...x, status: x.status === "new" ? "acknowledged" : x.status, chosenActionId: a.actionId ?? x.chosenActionId } : x) };
    case "respond-alert": return { ...data, alerts: data.alerts.map((x) => x.id === a.id
      ? { ...x, status: "supplier-responded", supplierResponse: a.response } : x) };
    case "resolve-alert": return { ...data, alerts: data.alerts.map((x) => x.id === a.id ? { ...x, status: "resolved" } : x) };
    case "send-invite": return { ...data, invites: [...data.invites, a.invite] };
    case "save-circular-profile": {
      const rest = (data.circularProfiles ?? []).filter((p) => !(p.companyId === a.profile.companyId && p.year === a.profile.year));
      return { ...data, circularProfiles: [...rest, a.profile] };
    }
    case "request-circular": {
      const open = (data.requests ?? []).some((r) => r.fromCompanyId === a.request.fromCompanyId
        && r.toCompanyId === a.request.toCompanyId && r.items.includes("circular") && r.status === "open");
      return open ? data : { ...data, requests: [...(data.requests ?? []), a.request] };
    }
    case "request-supplier-connection": {
      const open = (data.requests ?? []).some((r) => r.fromCompanyId === a.request.fromCompanyId
        && r.toCompanyId === a.request.toCompanyId && r.items.includes("connect-systems") && r.status === "open");
      return open ? data : { ...data, requests: [...(data.requests ?? []), a.request] };
    }
    case "answer-connection-requests": return { ...data, requests: (data.requests ?? []).map((r) =>
      (r.toCompanyId === a.supplierId && r.items.includes("connect-systems") && r.status === "open" ? { ...r, status: "answered" as const } : r)) };
    case "share-circular": {
      const pair = (x: Share) => x.supplierId === a.supplierId && x.customerId === a.customerId && x.items.includes("circular");
      const prev = (data.shares ?? []).filter(pair);
      const version = prev.reduce((m, x) => Math.max(m, x.version), 0) + 1;
      const shares = (data.shares ?? []).map((x) => (pair(x) ? { ...x, revoked: true } : x));
      const share: Share = {
        id: `share-circ-${a.supplierId}-${a.customerId}-v${version}`, supplierId: a.supplierId, customerId: a.customerId,
        requestId: a.requestId, items: ["circular"], approvedBy: a.approvedBy, approvedAt: a.approvedAt, version, circular: a.summary,
      };
      const requests = (data.requests ?? []).map((r) => (r.id === a.requestId ? { ...r, status: "answered" as const } : r));
      return { ...data, shares: [...shares, share], requests };
    }
    case "revoke-share": return { ...data, shares: (data.shares ?? []).map((x) => (x.id === a.id ? { ...x, revoked: true } : x)) };
    case "reset": return { ...a.seed };
  }
}
