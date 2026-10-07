// Live mode only: admin writes to `signals` through the admin-only RPCs of migration 20261015000000_admin_signals.sql.
// The server validates everything again (kind, dates, ranges, affects) and refuses non-admins.
import { supabase } from "./remote";
import type { Signal } from "./types";

/** An announced event the admin enters: a pre-announced blockade (by place) or a trade-policy event (by origin / HS code). */
export type AnnouncedSignal = Pick<Signal, "title" | "description" | "startsAt" | "endsAt" | "severity"> & {
  id?: string;
  kind: "blockade" | "policy";
  state?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  highways?: string[];
  transitMultiplier?: number;
  affects?: { originCountries?: string[]; hsPrefixes?: string[] };
};

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

/** Adds (or, with an `adm-` id, edits) an announced signal. Returns its id. */
export async function upsertAnnouncedSignal(sig: AnnouncedSignal): Promise<string> {
  const { data, error } = await supabase().rpc("admin_upsert_signal", { sig });
  fail(error);
  return data as string;
}

/** Disables or re-enables any signal. A live feed sets its own signals active again on its next run while it still reports them. */
export async function setSignalActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase().rpc("admin_set_signal_active", { signal_id: id, is_active: active });
  fail(error);
}
