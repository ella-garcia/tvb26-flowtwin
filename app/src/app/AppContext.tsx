// App state: testing toggles (pack, role, company, plan), route, and the demo data store.
// Logins are out of scope for v0; the toggles stand in for them.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import seedJson from "../data/seed/seed.json";
import type { PlanId, RoleId, Seed } from "../lib/types";
import { reduce, scope, type Action, type AppData, type Scope } from "../lib/dataLayer";
import { getPack, type Pack } from "../packs";
import * as remote from "../lib/remote";

const SEED = seedJson as Seed;
const STORE_KEY = "flowtwin-v0-data";
const TOGGLE_KEY = "flowtwin-v0-toggles";
const PROGRAM_KEY = "flowtwin-v0-program";

export type ModuleId =
  | "risk" | "parts" | "what-if" | "alerts" | "supplier" | "invite" | "tier1-data" // key customer (Tier 1): the v0 lead journey
  | "my-risk" | "data"                                 // supplier (Tier 2 owner / ops)
  | "signals" | "companies";                           // admin

export interface Route { module: ModuleId; sub?: string }

export type DataMode = "live" | "seed";
export type LoadStatus = "loading" | "ready" | "error";

/** SEED with every collection emptied: the placeholder shown while live data loads. */
const EMPTY: AppData = Object.fromEntries(Object.entries(SEED).map(([k, v]) => [k, Array.isArray(v) ? [] : v])) as AppData;

export interface Toggles { packId: string; role: RoleId; companyId: string; plan: PlanId }

interface Ctx {
  toggles: Toggles;
  setToggles: (t: Partial<Toggles>) => void;
  route: Route;
  go: (module: ModuleId, sub?: string) => void;
  pack: Pack;
  data: AppData;
  /** Access-controlled reads for the current viewer. */
  db: Scope;
  dispatch: (a: Action) => void;
  /** Vehicle programme the key customer is looking at ("all" = every model). Remembered per company. */
  programId: string;
  setProgramId: (id: string) => void;
  resetDemo: () => void;
  /** "live" = Supabase, "seed" = bundled demo data. */
  mode: DataMode;
  status: LoadStatus;
  error: string | null;
  /** Short message after a failed write-through; cleared by dismissNotice. */
  notice: string | null;
  dismissNotice: () => void;
  /** Give up on Supabase for this session and use the bundled seed. */
  useDemoData: () => void;
  retry: () => void;
}

const AppCtx = createContext<Ctx | null>(null);

export const DEFAULT_COMPANY: Record<RoleId, string> = { owner: "edl", ops: "edl", customer: "qss", admin: "platform" };
export const DEFAULT_MODULE: Record<RoleId, ModuleId> = { owner: "my-risk", ops: "data", customer: "risk", admin: "signals" };

function load<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? { ...fallback, ...JSON.parse(s) } : fallback; } catch { return fallback; }
}
function save(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ } }

function parseHash(role: RoleId): Route {
  const [m, sub] = (location.hash.replace(/^#/, "") || "").split("/");
  return m ? { module: m as ModuleId, sub } : { module: DEFAULT_MODULE[role] };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [toggles, setT] = useState<Toggles>(() => load(TOGGLE_KEY, { packId: "auto", role: "customer", companyId: "qss", plan: "paid" }));
  const [forcedSeed, setForcedSeed] = useState(false);
  const mode: DataMode = remote.isLive && !forcedSeed ? "live" : "seed";
  const [data, rawDispatch] = useReducer(reduce, undefined, () => {
    if (remote.isLive) return EMPTY;
    // Only the mutable slices persist; reference data always comes from the current seed.
    const saved = load<Partial<AppData>>(STORE_KEY, {});
    return { ...SEED, ...(saved.generatedAt === SEED.generatedAt ? saved : {}) } as AppData;
  });
  const [route, setRoute] = useState<Route>(() => parseHash(toggles.role));
  const [status, setStatus] = useState<LoadStatus>(remote.isLive ? "loading" : "ready");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reqId = useRef(0);
  const [programByCompany, setProgramByCompany] = useState<Record<string, string>>(() => load(PROGRAM_KEY, {}));
  useEffect(() => save(PROGRAM_KEY, programByCompany), [programByCompany]);
  const programId = programByCompany[toggles.companyId] ?? "all";
  const setProgramId = useCallback((id: string) => setProgramByCompany((m) => ({ ...m, [toggles.companyId]: id })), [toggles.companyId]);

  useEffect(() => save(TOGGLE_KEY, toggles), [toggles]);
  useEffect(() => {
    if (mode !== "seed") return; // live data is never persisted locally
    save(STORE_KEY, {
      generatedAt: data.generatedAt, uploads: data.uploads, relationships: data.relationships, alerts: data.alerts, invites: data.invites,
    });
  }, [data, mode]);
  useEffect(() => {
    const on = () => setRoute(parseHash(toggles.role));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [toggles.role]);

  // Live mode: (re)load whenever the identity changes or a reload is requested.
  useEffect(() => {
    if (mode !== "live") return;
    const id = ++reqId.current;
    setStatus("loading"); setError(null);
    (async () => {
      await remote.ensureSession();
      await remote.switchIdentity(toggles.role, toggles.companyId);
      const seed = await remote.loadAll();
      if (id !== reqId.current) return; // a newer load superseded this one
      rawDispatch({ type: "reset", seed });
      setStatus("ready");
    })().catch((e: unknown) => {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    });
  }, [mode, toggles.role, toggles.companyId, reloadTick]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);

  const go = useCallback((module: ModuleId, sub?: string) => {
    location.hash = sub ? `${module}/${sub}` : module;
    setRoute({ module, sub });
  }, []);

  const setToggles = useCallback((t: Partial<Toggles>) => {
    setT((prev) => {
      const next = { ...prev, ...t };
      if (t.role && t.role !== prev.role) {
        next.companyId = t.companyId ?? DEFAULT_COMPANY[t.role];
        const m = DEFAULT_MODULE[t.role];
        location.hash = m;
        setRoute({ module: m });
      }
      return next;
    });
  }, []);

  // Local reducer first (instant UI), then the matching backend call in live mode.
  const dispatch = useCallback((a: Action) => {
    rawDispatch(a);
    if (mode !== "live") return;
    let call: Promise<void> | null = null;
    switch (a.type) {
      case "acknowledge-alert": call = remote.acknowledgeAlert(a.id, a.actionId); break;
      case "resolve-alert": call = remote.resolveAlert(a.id); break;
      case "respond-alert": call = remote.respondAlert(a.id, a.response); break;
      case "send-invite": call = remote.sendInvite(a.invite); break;
      case "record-upload": call = remote.recordUpload(a.upload); break;
      default: break; // no backend yet: stays local
    }
    call?.catch((e: unknown) => {
      setNotice(`Could not save to the server: ${e instanceof Error ? e.message : String(e)}. Showing the server's data.`);
      reload();
    });
  }, [mode, reload]);

  const resetDemo = useCallback(() => {
    if (mode !== "live") { rawDispatch({ type: "reset", seed: SEED }); return; }
    remote.resetRemoteDemo().then(reload).catch((e: unknown) => {
      setNotice(`Could not reset the demo data: ${e instanceof Error ? e.message : String(e)}`);
      reload();
    });
  }, [mode, reload]);

  const useDemoData = useCallback(() => {
    reqId.current++;
    setForcedSeed(true); setStatus("ready"); setError(null); setNotice(null);
    rawDispatch({ type: "reset", seed: SEED });
  }, []);

  const value = useMemo<Ctx>(() => ({
    toggles, setToggles, route, go, pack: getPack(toggles.packId), data,
    db: scope(data, { role: toggles.role, companyId: toggles.companyId }),
    dispatch, programId, setProgramId, resetDemo, mode, status, error, notice, dismissNotice: () => setNotice(null), useDemoData, retry: reload,
  }), [toggles, setToggles, route, go, data, dispatch, programId, setProgramId, resetDemo, mode, status, error, notice, useDemoData, reload]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
