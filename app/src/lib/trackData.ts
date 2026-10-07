// Twin track record (WP3): alert outcomes and risk snapshots.
// Live mode reads `alert_outcomes` (with its alert) and `risk_history` through the Supabase client; RLS decides the rows.
// Seed mode reads the bundled sample data (data/track-demo.json), filtered to the viewer's pairs exactly as
// dataLayer.scope does for risks and alerts: a key customer its own suppliers, a supplier (owner / ops) itself, admin none.
import { useEffect, useMemo, useState } from "react";
import demoJson from "../data/track-demo.json";
import { rowToApp, rowsToApp } from "./caseMap";
import type { Viewer } from "./dataLayer";
import { supabase } from "./remote";
import type { AlertOutcome, AlertOutcomeKind, MissedEvent, RiskHistoryRow, RiskLevel } from "./types";

/** The alert an outcome belongs to (the fields the card shows). */
export interface TrackAlert {
  id: string;
  customerId: string;
  supplierId: string;
  level: RiskLevel;
  createdAt: string;
  title: string;
  partIds: string[];
}
export interface TrackEntry { alert: TrackAlert; outcome: AlertOutcome }
export interface TrackData {
  entries: TrackEntry[];
  /** risk_history rows of the days the alerts were raised: what the twin predicted at the time. */
  history: RiskHistoryRow[];
  /** Delivery problems with no alert before them (missed_events). */
  misses: MissedEvent[];
  /** True for the bundled sample data (seed mode). */
  sample: boolean;
}

export const TRACK_DEMO: TrackData = {
  entries: (demoJson as unknown as { entries: TrackEntry[] }).entries,
  history: (demoJson as unknown as { history: RiskHistoryRow[] }).history,
  misses: (demoJson as unknown as { misses?: MissedEvent[] }).misses ?? [],
  sample: true,
};

/** Same rule as dataLayer.scope's canSeeRisk (and can_see_pair in the database). */
export function canSeePair(viewer: Viewer, customerId: string, supplierId: string): boolean {
  return (viewer.role === "customer" && viewer.companyId === customerId)
    || ((viewer.role === "owner" || viewer.role === "ops") && viewer.companyId === supplierId);
}

/** Seed mode: only the viewer's pairs. */
export function scopeTrack(data: TrackData, viewer: Viewer): TrackData {
  return {
    entries: data.entries.filter((e) => canSeePair(viewer, e.alert.customerId, e.alert.supplierId)),
    history: data.history.filter((h) => canSeePair(viewer, h.customerId, h.supplierId)),
    misses: data.misses.filter((m) => canSeePair(viewer, m.customerId, m.supplierId)),
    sample: data.sample,
  };
}

/** Narrow to one customer and/or one supplier (a card on a supplier page shows one pair). */
export function filterPair(data: TrackData, pair: { customerId?: string; supplierId?: string }): TrackData {
  const keep = (c: string, s: string) => (!pair.customerId || c === pair.customerId) && (!pair.supplierId || s === pair.supplierId);
  return {
    entries: data.entries.filter((e) => keep(e.alert.customerId, e.alert.supplierId)),
    history: data.history.filter((h) => keep(h.customerId, h.supplierId)),
    misses: data.misses.filter((m) => keep(m.customerId, m.supplierId)),
    sample: data.sample,
  };
}

export const TRACK_WINDOW_DAYS = 90;
export const OUTCOME_ORDER: AlertOutcomeKind[] = ["hit", "prevented", "false-alarm", "unknown", "pending", "miss"];

export interface TrackSummary {
  /** Entries of alerts raised in the window, newest first. */
  entries: TrackEntry[];
  counts: Record<AlertOutcomeKind, number>;
  /** hit + prevented */
  right: number;
  /** hit + prevented + false-alarm (unknown and pending are counted but not rated) */
  rated: number;
  /** right / rated, or null when nothing is rated yet */
  rate: number | null;
  /** Misses in the window, newest first (counted in counts.miss, not in the rate). */
  misses: MissedEvent[];
  since: string;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Hit rate over the alerts raised in the last `days` days up to asOf: (hit + prevented) / (hit + prevented + false alarm). */
export function summarize(entries: TrackEntry[], asOf: string, days = TRACK_WINDOW_DAYS, misses: MissedEvent[] = []): TrackSummary {
  const since = addDays(asOf, -days);
  const shown = entries.filter((e) => e.alert.createdAt >= since && e.alert.createdAt <= asOf)
    .sort((a, b) => b.alert.createdAt.localeCompare(a.alert.createdAt));
  const counts = { hit: 0, prevented: 0, "false-alarm": 0, unknown: 0, pending: 0, miss: 0 } as Record<AlertOutcomeKind, number>;
  for (const e of shown) counts[e.outcome.outcome] += 1;
  const missed = misses.filter((m) => m.eventDate >= since && m.eventDate <= asOf)
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  counts.miss = missed.length;
  const right = counts.hit + counts.prevented;
  const rated = right + counts["false-alarm"];
  return { entries: shown, counts, right, rated, rate: rated > 0 ? right / rated : null, misses: missed, since };
}

/** The snapshot of the pair on the day the alert was raised, if one was kept. */
export function predictionAtTheTime(data: TrackData, a: TrackAlert): RiskHistoryRow | undefined {
  return data.history.find((h) => h.customerId === a.customerId && h.supplierId === a.supplierId && h.asOf === a.createdAt);
}

// ---- Live mode ----
const ALERT_FIELDS = "id, customer_id, supplier_id, level, created_at, title, part_ids";

/** Every outcome the signed-in identity may read (RLS), with its alert, plus the snapshots of the alerts' days. */
export async function loadTrackLive(): Promise<TrackData> {
  const sb = supabase();
  const o = await sb.from("alert_outcomes").select(`*, alerts(${ALERT_FIELDS})`);
  if (o.error) throw new Error(`alert_outcomes: ${o.error.message}`);
  const entries: TrackEntry[] = [];
  for (const row of (o.data ?? []) as Record<string, unknown>[]) {
    const { alerts, ...rest } = row;
    if (!alerts || typeof alerts !== "object") continue; // the alert is not visible to this identity
    const outcome = rowToApp<AlertOutcome>(rest);
    entries.push({ alert: rowToApp<TrackAlert>(alerts as Record<string, unknown>), outcome: { ...outcome, partIds: outcome.partIds ?? [], evidence: outcome.evidence ?? [] } });
  }
  const days = Array.from(new Set(entries.map((e) => e.alert.createdAt)));
  let history: RiskHistoryRow[] = [];
  if (days.length > 0) {
    const h = await sb.from("risk_history")
      .select("customer_id, supplier_id, as_of, level, score, days_to_line_stop, part_stop_days").in("as_of", days);
    if (h.error) throw new Error(`risk_history: ${h.error.message}`);
    history = rowsToApp<RiskHistoryRow>(h.data);
  }
  const m = await sb.from("missed_events").select("customer_id, supplier_id, part_id, event_date, evidence, rule_version, detected_at");
  if (m.error) throw new Error(`missed_events: ${m.error.message}`);
  return { entries, history, misses: rowsToApp<MissedEvent>(m.data), sample: false };
}

export type TrackState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: TrackData };

/** Track data for the viewer, narrowed to a pair. `mode` and `viewer` come from useApp(). */
export function useTrack(mode: "live" | "seed", viewer: Viewer, pair: { customerId?: string; supplierId?: string }): TrackState {
  const who = `${viewer.role}:${viewer.companyId}`;
  const [live, setLive] = useState<{ who: string; data?: TrackData; error?: string } | null>(null);
  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    loadTrackLive().then(
      (data) => { if (!cancelled) setLive({ who, data }); },
      (e: unknown) => { if (!cancelled) setLive({ who, error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { cancelled = true; };
  }, [mode, who]);

  const { role, companyId } = viewer;
  const { customerId, supplierId } = pair;
  return useMemo((): TrackState => {
    if (mode === "seed") return { status: "ready", data: filterPair(scopeTrack(TRACK_DEMO, { role, companyId }), { customerId, supplierId }) };
    if (!live || live.who !== `${role}:${companyId}`) return { status: "loading" };
    if (live.error || !live.data) return { status: "error", error: live.error ?? "No data" };
    return { status: "ready", data: filterPair(live.data, { customerId, supplierId }) };
  }, [mode, live, role, companyId, customerId, supplierId]);
}
