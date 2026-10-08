// Live mode: Supabase client, session, identity switch, data load and write-through calls.
// Seed mode never imports anything from here at runtime beyond `isLive`.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Alert, AlertNotification, CircularProfile, CircularSummary, Connection, Invite, RoleId, Seed, Settings, UploadRecord } from "./types";
import { rowToApp, rowsToApp, rowToDb } from "./caseMap";

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Live mode when both env vars are set; otherwise the app runs on the bundled seed. */
export const isLive = Boolean(URL && KEY);

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!URL || !KEY) throw new Error("Supabase is not configured");
  client ??= createClient(URL, KEY);
  return client;
}

export async function ensureSession(): Promise<void> {
  const sb = supabase();
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  if (data.session) return;
  const r = await sb.auth.signInAnonymously();
  if (r.error) throw r.error;
}

export async function switchIdentity(role: RoleId, company: string): Promise<void> {
  const { error } = await supabase().rpc("switch_test_identity", { new_role: role, new_company: company });
  if (error) throw error;
}

const PAGE = 1000;
async function fetchTable(table: string, order?: string): Promise<Record<string, unknown>[]> {
  const sb = supabase();
  const all: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select("*");
    if (order) q = q.order(order);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

/** Load every table the current identity can read (RLS filters rows) and assemble the Seed shape. */
export async function loadAll(): Promise<Seed> {
  const t = async (name: string, order?: string) => fetchTable(name, order);
  const [companies, relationships, signals, sites, partners, lanes, machines, certs,
    uploads, parts, risks, alerts, invites, settings, programs] = await Promise.all([
    t("companies"), t("relationships"), t("signals"), t("sites"), t("partners"), t("lanes"),
    t("machines"), t("certifications"), t("uploads"), t("parts"), t("risks"), t("alerts"), t("invites"), t("app_settings"),
    // Added after the first live release: a database without the table still loads (no models shown).
    t("vehicle_programs").catch(() => [] as Record<string, unknown>[]),
  ]);
  // Circular layer (a database without these tables still loads; the pages show empty states).
  const opt = (name: string) => t(name).catch(() => [] as Record<string, unknown>[]);
  const [factors, plans, circular, requests, shares] = await Promise.all([
    opt("emission_factors"), opt("consolidation_plans"), opt("circular_profiles"), opt("requests"), opt("shares"),
  ]);
  const s = settings[0] as Record<string, unknown> | undefined;
  return {
    generatedAt: new Date().toISOString(),
    asOf: (s?.as_of as string) ?? new Date().toISOString().slice(0, 10),
    companies: rowsToApp(companies),
    relationships: rowsToApp(relationships),
    sites: rowsToApp(sites),
    partners: rowsToApp(partners),
    lanes: rowsToApp(lanes),
    machines: rowsToApp(machines),
    certifications: rowsToApp(certs),
    uploads: rowsToApp(uploads),
    settings: {
      lineStopCostEurPerMinute: Number(s?.line_stop_cost_eur_per_minute ?? 15000),
      contractDemandSwing: Number(s?.contract_demand_swing ?? 0.15),
      lineHoursPerDay: Number(s?.line_hours_per_day ?? 16),
      palletsPerTruck: Number(s?.pallets_per_truck ?? 24),
      expediteTripsPerShortDay: Number(s?.expedite_trips_per_short_day ?? 1),
      expediteFillRate: Number(s?.expedite_fill_rate ?? 0.3),
      milkrunRadiusKm: Number(s?.milkrun_radius_km ?? 120),
    } satisfies Settings,
    parts: rowsToApp(parts),
    programs: rowsToApp(programs),
    signals: rowsToApp(signals),
    risks: rowsToApp(risks),
    alerts: rowsToApp(alerts),
    invites: rowsToApp(invites),
    emissionFactors: rowsToApp(factors),
    consolidationPlans: rowsToApp(plans),
    circularProfiles: rowsToApp(circular),
    requests: rowsToApp(requests),
    shares: rowsToApp(shares),
  };
}

// ---- Write-through (each throws on backend error) ----
const must = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

export const acknowledgeAlert = async (id: string, actionId?: string) =>
  must(await supabase().rpc("acknowledge_alert", { alert_id: id, action_id: actionId ?? null }));
export const resolveAlert = async (id: string) => must(await supabase().rpc("resolve_alert", { alert_id: id }));
export const respondAlert = async (id: string, response: NonNullable<Alert["supplierResponse"]>) =>
  must(await supabase().rpc("respond_alert", { alert_id: id, response }));
export const sendInvite = async (invite: Invite) => must(await supabase().from("invites").insert(rowToDb(invite)));
export const recordUpload = async (u: UploadRecord) =>
  must(await supabase().from("uploads").upsert(rowToDb(u), { onConflict: "company_id,kind" }));
export const resetRemoteDemo = async () => must(await supabase().rpc("reset_demo"));

// ---- Circular layer ----
export const saveCircularProfile = async (p: CircularProfile) =>
  must(await supabase().from("circular_profiles").upsert(rowToDb({ ...p, updatedAt: new Date().toISOString() }), { onConflict: "company_id,year" }));
export const requestCircular = async (supplierId: string, note?: string) =>
  must(await supabase().rpc("request_circular", { supplier: supplierId, note: note ?? null }));
export const shareCircular = async (customerId: string, summary: CircularSummary, requestId?: string) =>
  must(await supabase().rpc("share_circular", { customer: customerId, summary, request: requestId ?? null }));
export const revokeShare = async (shareId: string) => must(await supabase().rpc("revoke_share", { share_id: shareId }));

// ---- Tier 1 uploads and notifications ----
/** Upload a file to the private 'uploads' bucket at <company>/<kind>/<timestamp>-<name>. Returns the storage path. */
export async function uploadFile(companyId: string, kind: string, file: File): Promise<string> {
  const path = `${companyId}/${kind}/${Date.now()}-${file.name}`;
  const { error } = await supabase().storage.from("uploads").upload(path, file, { upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Record the upload as waiting, then queue the parse job for the worker. Returns the job id when known. */
export async function queueParseJob(companyId: string, kind: string, storagePath: string, fileName: string): Promise<number | undefined> {
  const sb = supabase();
  must(await sb.from("uploads").upsert({
    company_id: companyId, kind, file_name: fileName, rows: 0, source: "Upload", status: "waiting",
    storage_path: storagePath, uploaded_at: new Date().toISOString(), issues: [], mapping: {},
  }, { onConflict: "company_id,kind" }));
  const r = await sb.from("jobs").insert({
    kind: "parse-upload", company_id: companyId,
    payload: { company_id: companyId, kind, storage_path: storagePath, file_name: fileName },
  }).select("id");
  if (r.error) throw new Error(r.error.message);
  return (r.data?.[0] as { id?: number } | undefined)?.id;
}

export async function fetchUploads(companyId: string): Promise<UploadRecord[]> {
  const { data, error } = await supabase().from("uploads").select("*").eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return rowsToApp<UploadRecord>(data);
}

/** Data connections of a company (ERP, logistics platform, file drop). RLS: own company, or admin. */
export async function fetchConnections(companyId: string): Promise<Connection[]> {
  const { data, error } = await supabase().from("connections").select("*").eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return rowsToApp<Connection>(data);
}

/** Ask the FlowTwin team to connect a system for the caller's company: a pending `connections` row (idempotent). */
export async function requestConnection(provider: string): Promise<Connection> {
  const { data, error } = await supabase().rpc("request_connection", { p_provider: provider });
  if (error) throw new Error(error.message);
  return rowToApp<Connection>(data as Record<string, unknown>);
}

/** Connection status of the given companies (own company, or a key customer's suppliers): provider and status only. */
export async function fetchPairConnections(companyIds: string[]): Promise<Connection[]> {
  if (companyIds.length === 0) return [];
  const { data, error } = await supabase().from("pair_connections").select("*").in("company_id", companyIds);
  if (error) throw new Error(error.message);
  return rowsToApp<Connection>(data);
}

/** Key customer asks one of its suppliers to connect its systems (one open request per pair). */
export const requestSupplierConnection = async (supplierId: string, note?: string) =>
  must(await supabase().rpc("request_supplier_connection", { supplier: supplierId, note: note ?? null }));

export async function fetchNotifications(alertIds: string[]): Promise<AlertNotification[]> {
  if (alertIds.length === 0) return [];
  const { data, error } = await supabase().from("alert_notifications").select("*").in("alert_id", alertIds);
  if (error) throw new Error(error.message);
  return rowsToApp<Record<string, unknown>>(data).map((r) => ({
    id: r.id != null ? String(r.id) : undefined,
    alertId: String(r.alertId),
    recipient: (r.recipient ?? r.recipientEmail ?? r.email ?? r.to) as string | undefined,
    channel: r.channel as string | undefined,
    status: r.status as string | undefined,
    dryRun: typeof r.dryRun === "boolean" ? r.dryRun : r.status === "dry-run" || r.status === "dry_run",
    sentAt: (r.sentAt ?? r.createdAt) as string | undefined,
  }));
}
