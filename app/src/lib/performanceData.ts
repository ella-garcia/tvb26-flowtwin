// Inputs for the Performance view that the app does not load with everything else: goods receipts and daily risk
// snapshots. Same pattern as lib/trackData.ts: live mode reads them through the Supabase client (RLS decides the rows);
// seed mode reads the bundled sample (data/performance-demo.json, loaded on demand) filtered to the viewer's pairs.
import { useEffect, useState } from "react";
import { rowsToApp } from "./caseMap";
import type { Viewer } from "./dataLayer";
import { addDays } from "./performance";
import { supabase } from "./remote";
import { canSeePair } from "./trackData";
import type { Receipt, RiskHistoryRow } from "./types";

export const RECEIPT_DAYS = 180;  // the longest period the page offers
export const HISTORY_DAYS = 90;

export interface PerformanceExtra { receipts: Receipt[]; history: RiskHistoryRow[]; sample: boolean }
export type PerformanceExtraState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: PerformanceExtra };

/** Seed mode: only the viewer's pairs, and only the window the page uses. */
export function scopeExtra(data: PerformanceExtra, viewer: Viewer, asOf: string): PerformanceExtra {
  const rFrom = addDays(asOf, -RECEIPT_DAYS), hFrom = addDays(asOf, -HISTORY_DAYS);
  return {
    receipts: data.receipts.filter((r) => canSeePair(viewer, r.customerId, r.supplierId) && r.promisedDate >= rFrom),
    history: data.history.filter((h) => canSeePair(viewer, h.customerId, h.supplierId) && h.asOf >= hFrom),
    sample: data.sample,
  };
}

async function loadSeed(): Promise<PerformanceExtra> {
  const m = await import("../data/performance-demo.json");
  const d = m.default as unknown as { receipts: Receipt[]; history: RiskHistoryRow[] };
  return { receipts: d.receipts, history: d.history, sample: true };
}

export async function loadLive(asOf: string): Promise<PerformanceExtra> {
  const sb = supabase();
  const [r, h] = await Promise.all([
    sb.from("receipts").select("customer_id, supplier_id, part_id, po_number, promised_date, received_date, quantity_ordered, quantity_received, source, source_ref")
      .gte("promised_date", addDays(asOf, -RECEIPT_DAYS)),
    sb.from("risk_history").select("customer_id, supplier_id, as_of, level, score, days_to_line_stop")
      .gte("as_of", addDays(asOf, -HISTORY_DAYS)),
  ]);
  if (r.error) throw new Error(`receipts: ${r.error.message}`);
  if (h.error) throw new Error(`risk_history: ${h.error.message}`);
  return { receipts: rowsToApp<Receipt>(r.data), history: rowsToApp<RiskHistoryRow>(h.data), sample: false };
}

/** Receipts and snapshots for the viewer. `mode`, `viewer` and `asOf` come from useApp(). */
export function usePerformanceExtra(mode: "live" | "seed", viewer: Viewer, asOf: string): PerformanceExtraState {
  const key = `${mode}:${viewer.role}:${viewer.companyId}:${asOf}`;
  const [state, setState] = useState<{ key: string; data?: PerformanceExtra; error?: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = mode === "live" ? loadLive(asOf) : loadSeed().then((d) => scopeExtra(d, viewer, asOf));
    load.then(
      (data) => { if (!cancelled) setState({ key, data }); },
      (e: unknown) => { if (!cancelled) setState({ key, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { cancelled = true; };
    // viewer is captured through key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!state || state.key !== key) return { status: "loading" };
  if (state.error || !state.data) return { status: "error", error: state.error ?? "No data" };
  return { status: "ready", data: state.data };
}
