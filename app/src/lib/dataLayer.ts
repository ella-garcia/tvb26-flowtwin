// The data layer. ALL reads go through `scope(state, viewer)`, which enforces who may see what.
// Rule: a key customer sees risks, alerts and parts for its own suppliers; operating data
// (machines, partners, uploads, customer relationships) is readable only by the company that owns it.
import type {
  Company, CustomerRelationship, Machine, Partner, RoleId, Seed, UploadRecord,
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
    case "reset": return { ...a.seed };
  }
}
