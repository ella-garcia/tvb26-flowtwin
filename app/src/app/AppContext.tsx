// App state: testing toggles (pack, role, company, plan), route, and the demo data store.
// Logins are out of scope for v0; the toggles stand in for them.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import seedJson from "../data/seed/seed.json";
import type { PlanId, RoleId, Seed } from "../lib/types";
import { reduce, scope, type Action, type AppData, type Scope } from "../lib/dataLayer";
import { getPack, type Pack } from "../packs";

const SEED = seedJson as unknown as Seed;
const STORE_KEY = "flowtwin-v0-data";
const TOGGLE_KEY = "flowtwin-v0-toggles";

export type ModuleId =
  | "risk" | "alerts" | "supplier" | "invite"          // key customer (Tier 1): the v0 lead journey
  | "my-risk" | "data"                                 // supplier (Tier 2 owner / ops)
  | "signals" | "companies";                           // admin

export interface Route { module: ModuleId; sub?: string }

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
  resetDemo: () => void;
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
  const [data, dispatch] = useReducer(reduce, undefined, () => {
    // Only the mutable slices persist; reference data always comes from the current seed.
    const saved = load<Partial<AppData>>(STORE_KEY, {});
    return { ...SEED, ...(saved.generatedAt === SEED.generatedAt ? saved : {}) } as AppData;
  });
  const [route, setRoute] = useState<Route>(() => parseHash(toggles.role));

  useEffect(() => save(TOGGLE_KEY, toggles), [toggles]);
  useEffect(() => save(STORE_KEY, {
    generatedAt: data.generatedAt, requests: data.requests, shares: data.shares, uploads: data.uploads,
    relationships: data.relationships, emissionFactors: data.emissionFactors, alerts: data.alerts, invites: data.invites,
  }), [data]);
  useEffect(() => {
    const on = () => setRoute(parseHash(toggles.role));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, [toggles.role]);

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

  const value = useMemo<Ctx>(() => ({
    toggles, setToggles, route, go, pack: getPack(toggles.packId), data,
    db: scope(data, { role: toggles.role, companyId: toggles.companyId }),
    dispatch, resetDemo: () => dispatch({ type: "reset", seed: SEED }),
  }), [toggles, setToggles, route, go, data]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
