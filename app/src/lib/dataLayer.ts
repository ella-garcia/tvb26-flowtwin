// The data layer. ALL reads go through `scope(state, viewer)`, which enforces who may see what.
// Rule: a key customer sees only what a supplier explicitly shared (frozen payloads in `Share`).
// Costs, margins, lanes, KPIs and twins are readable only by the company that owns them.
import type {
  Company, CustomerRelationship, DataRequest, EmissionFactor, Lane, Machine, Partner, RequirementProfile,
  RoleId, Seed, Share, Site, Twin, UploadRecord, KpiValue, EnergyMonth, MaterialPurchase, Shipment, Certification,
  Alert, Invite, Part, RiskAssessment, Signal, VehicleProgram,
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
    sites: (companyId: string): Site[] => byCompany(data.sites, companyId, "sites"),
    partners: (companyId: string): Partner[] => byCompany(data.partners, companyId, "suppliers and customers"),
    lanes: (companyId: string): Lane[] => byCompany(data.lanes, companyId, "lanes and freight costs"),
    machines: (companyId: string): Machine[] => byCompany(data.machines, companyId, "machines"),
    kpis: (companyId: string): KpiValue[] => byCompany(data.kpis, companyId, "indicators"),
    energy: (companyId: string): EnergyMonth[] => byCompany(data.energy, companyId, "energy bills"),
    materials: (companyId: string): MaterialPurchase[] => byCompany(data.materials, companyId, "material purchases"),
    shipments: (companyId: string): Shipment[] => byCompany(data.shipments, companyId, "shipments"),
    certifications: (companyId: string): Certification[] => byCompany(data.certifications, companyId, "certifications"),
    uploads: (companyId: string): UploadRecord[] => byCompany(data.uploads, companyId, "uploads"),
    twin: (companyId: string): Twin | undefined => { own(companyId, "the digital twin"); return data.twins.find((t) => t.companyId === companyId); },
    /** Freight and operating costs. Never shareable, by design. */
    costs: (companyId: string) => {
      own(companyId, "costs and margins");
      const lanes = data.lanes.filter((l) => l.companyId === companyId);
      return { freightPerWeekMxn: lanes.reduce((a, l) => a + l.costPerTripMxn * l.tripsPerWeek, 0), lanes };
    },
    /** A supplier's relationships with its customers (own company only). */
    customersOf: (supplierId: string): CustomerRelationship[] => {
      own(supplierId, "customer relationships");
      return data.relationships.filter((r) => r.supplierId === supplierId);
    },

    // ---- Requests and shares ----
    /** Requests a supplier received, or a key customer sent. */
    requests: (): DataRequest[] => data.requests.filter((r) =>
      viewer.role === "customer" ? r.fromCompanyId === viewer.companyId : r.toCompanyId === viewer.companyId),
    /** Shares visible to the viewer: a supplier sees what it shared; a customer sees what was shared with it. */
    shares: (): Share[] => data.shares.filter((s) => !s.revoked && (
      viewer.role === "customer" ? s.customerId === viewer.companyId : s.supplierId === viewer.companyId)),
    /** For a key customer: its suppliers on the platform, with public metadata only. */
    suppliersOf: (customerId: string) => {
      if (viewer.role !== "customer" || viewer.companyId !== customerId) throw new AccessDeniedError("supplier list");
      return data.relationships.filter((r) => r.customerId === customerId)
        .map((r) => ({ company: data.companies.find((c) => c.id === r.supplierId)!, chainPosition: r.chainPosition, requirements: r.requirements }))
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

    // ---- Reference data (anyone) ----
    emissionFactors: (): EmissionFactor[] => data.emissionFactors,
    factor: (id: string): EmissionFactor | undefined =>
      data.emissionFactors.filter((f) => f.id === id).sort((a, b) => b.version - a.version)[0],
  };
}

export type Scope = ReturnType<typeof scope>;

// ---- Mutations (pure; the store applies them) ----
export type Action =
  | { type: "send-request"; request: DataRequest }
  | { type: "set-request-status"; id: string; status: DataRequest["status"] }
  | { type: "approve-share"; share: Omit<Share, "id" | "version"> }
  | { type: "revoke-share"; id: string }
  | { type: "record-upload"; upload: UploadRecord }
  | { type: "set-requirements"; supplierId: string; customerId: string; requirements: RequirementProfile }
  | { type: "add-factor-version"; factor: EmissionFactor }
  | { type: "acknowledge-alert"; id: string; actionId?: string }
  | { type: "respond-alert"; id: string; response: NonNullable<Alert["supplierResponse"]> }
  | { type: "resolve-alert"; id: string }
  | { type: "send-invite"; invite: Invite }
  | { type: "reset"; seed: Seed };

export function reduce(data: AppData, a: Action): AppData {
  switch (a.type) {
    case "send-request": return { ...data, requests: [...data.requests, a.request] };
    case "set-request-status": return { ...data, requests: data.requests.map((r) => r.id === a.id ? { ...r, status: a.status } : r) };
    case "approve-share": {
      const prev = data.shares.filter((s) => s.supplierId === a.share.supplierId && s.customerId === a.share.customerId);
      const version = prev.reduce((m, s) => Math.max(m, s.version), 0) + 1;
      // A new approval replaces earlier versions for the same pair.
      const shares = data.shares.map((s) => s.supplierId === a.share.supplierId && s.customerId === a.share.customerId ? { ...s, revoked: true } : s);
      return { ...data, shares: [...shares, { ...a.share, id: `share-${a.share.supplierId}-${a.share.customerId}-v${version}`, version }] };
    }
    case "revoke-share": return { ...data, shares: data.shares.map((s) => s.id === a.id ? { ...s, revoked: true } : s) };
    case "record-upload": {
      const rest = data.uploads.filter((u) => !(u.companyId === a.upload.companyId && u.kind === a.upload.kind));
      return { ...data, uploads: [...rest, a.upload] };
    }
    case "set-requirements": return {
      ...data, relationships: data.relationships.map((r) =>
        r.supplierId === a.supplierId && r.customerId === a.customerId ? { ...r, requirements: a.requirements } : r),
    };
    case "add-factor-version": return { ...data, emissionFactors: [...data.emissionFactors, a.factor] };
    case "acknowledge-alert": return { ...data, alerts: data.alerts.map((x) => x.id === a.id
      ? { ...x, status: x.status === "new" ? "acknowledged" : x.status, chosenActionId: a.actionId ?? x.chosenActionId } : x) };
    case "respond-alert": return { ...data, alerts: data.alerts.map((x) => x.id === a.id
      ? { ...x, status: "supplier-responded", supplierResponse: a.response } : x) };
    case "resolve-alert": return { ...data, alerts: data.alerts.map((x) => x.id === a.id ? { ...x, status: "resolved" } : x) };
    case "send-invite": return { ...data, invites: [...data.invites, a.invite] };
    case "reset": return { ...a.seed };
  }
}
