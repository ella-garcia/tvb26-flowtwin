// Twin track record (WP3): how often past alerts came true, judged from receipts. Shown to both sides of a pair:
// the key customer on Alerts (all its suppliers) and on supplier detail; the supplier on My risk (the same numbers about itself).
import { useApp } from "../../app/AppContext";
import { StatusPill, type PillTone } from "../../keystone";
import { date, days, pct, riskWord } from "../../lib/format";
import { OUTCOME_ORDER, TRACK_WINDOW_DAYS, predictionAtTheTime, summarize, useTrack, type TrackEntry } from "../../lib/trackData";
import type { AlertOutcome, AlertOutcomeKind } from "../../lib/types";
import { Card, Empty, FormulaSource } from "../shared";
import "./track.css";

const OUTCOME: Record<AlertOutcomeKind, { label: string; tone: PillTone; meaning: string }> = {
  hit: { label: "Hit", tone: "danger", meaning: "the shortfall happened" },
  prevented: { label: "Prevented", tone: "success", meaning: "acted on, deliveries on time" },
  "false-alarm": { label: "False alarm", tone: "warning", meaning: "on time with no action" },
  unknown: { label: "Unknown", tone: "neutral", meaning: "no receipts to judge by" },
  pending: { label: "Pending", tone: "neutral", meaning: "stop date not passed yet" },
  miss: { label: "Missed", tone: "danger", meaning: "a problem without an alert" },
};

const EVIDENCE_KIND: Record<AlertOutcome["evidence"][number]["kind"], string> = {
  receipt: "Receipt", "shipment-notice": "Shipment notice", action: "Action",
};

export interface TrackRecordCardProps {
  customerId?: string;
  supplierId?: string;
  /** "supplier" words the card for the supplier looking at itself (My risk). */
  audience: "customer" | "supplier";
}

export function TrackRecordCard({ customerId, supplierId, audience }: TrackRecordCardProps) {
  const { db, mode } = useApp();
  const state = useTrack(mode, db.viewer, { customerId, supplierId });
  const tag = mode === "seed" ? <StatusPill tone="warning">Sample data</StatusPill> : undefined;

  if (state.status === "loading") return <Card title="Track record" actions={tag}><p className="track-note">Loading the track record…</p></Card>;
  if (state.status === "error") {
    return <Card title="Track record" actions={tag}><p className="track-note">The track record could not be loaded ({state.error}).</p></Card>;
  }
  const { data } = state;
  const s = summarize(data.entries, db.asOf, TRACK_WINDOW_DAYS, data.misses);
  const nameOf = (id: string) => db.company(id)?.name ?? id;
  const partLabel = (id: string) => { const p = db.parts().find((x) => x.id === id); return p ? `${p.number} · ${p.name}` : id; };
  const showSupplier = !supplierId;
  const showCustomer = !customerId;
  const subject = audience === "supplier" ? "alerts about you" : supplierId ? "alerts about this supplier" : "alerts about your suppliers";

  return (
    <Card title="Track record" actions={tag} className="track-card">
      {s.entries.length === 0 && s.misses.length === 0 ? (
        <Empty title="Nothing evaluated yet">
          Each alert is checked against goods receipts one day after its predicted stop date. Results for {subject} appear
          here; the last {TRACK_WINDOW_DAYS} days are shown.
        </Empty>
      ) : (
        <>
          <div className="track-summary">
            <div className="track-rate">
              <span className="track-rate-label">Hit rate, last {TRACK_WINDOW_DAYS} days</span>
              <span className="track-rate-value ks-num">{s.rate == null ? "Not rated yet" : pct(s.rate, 0)}</span>
              <span className="track-note">
                {s.rate == null
                  ? "No alert has a hit, prevented or false-alarm verdict yet."
                  : `${s.right} of ${s.rated} rated ${subject} came true or were prevented.`}
              </span>
            </div>
            <ul className="track-counts" aria-label="Alerts by outcome">
              {OUTCOME_ORDER.map((k) => (
                <li key={k}>
                  <span className="track-count ks-num">{s.counts[k]}</span>
                  <StatusPill tone={OUTCOME[k].tone}>{OUTCOME[k].label}</StatusPill>
                  <span className="track-count-meaning">{OUTCOME[k].meaning}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="track-note">
            Unknown and pending alerts are counted but left out of the rate: we do not guess an outcome without receipts.
            Missed problems (no alert in the 3 days before) are listed below and are not part of the rate either.
          </p>
          <ol className="track-list">
            {s.entries.map((e) => (
              <TrackItem key={e.alert.id} entry={e} prediction={predictionAtTheTime(data, e.alert)}
                who={[showSupplier && nameOf(e.alert.supplierId), showCustomer && `for ${nameOf(e.alert.customerId)}`].filter(Boolean).join(" ")} />
            ))}
          </ol>
          {s.misses.length > 0 && (
            <>
              <h3 className="track-subhead">Missed: problems without an alert</h3>
              <ol className="track-list">
                {s.misses.map((m) => (
                  <li key={`${m.customerId}-${m.supplierId}-${m.partId}-${m.eventDate}`} className="track-item">
                    <div className="track-item-head">
                      <StatusPill tone={OUTCOME.miss.tone}>{OUTCOME.miss.label}</StatusPill>
                      <span className="track-item-title">{partLabel(m.partId)}</span>
                    </div>
                    <p className="track-meta">
                      {[showSupplier && nameOf(m.supplierId), showCustomer && `for ${nameOf(m.customerId)}`].filter(Boolean).join(" ")}
                      {(showSupplier || showCustomer) && " · "}{date(m.eventDate)}
                      {m.evidence[0]?.note && <> · {m.evidence[0].note}</>}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <FormulaSource
        formula={`Hit rate = (hit + prevented) / (hit + prevented + false alarm), over alerts raised in the last ${TRACK_WINDOW_DAYS} days. `
          + "An alert is judged one day after its predicted stop date, over its window (alert raised to predicted stop date, ±1 day). "
          + "Hit: a late or short receipt, or a known stock-out, for the alert's parts in the window. "
          + "Prevented: no such problem, and the key customer chose an action or the supplier confirmed capacity. "
          + "False alarm: on-time, complete deliveries and no action. Unknown: no receipts or shipment notices in the window. "
          + "Missed: a late or short receipt (or stock-out) with no alert in the 3 days before; listed, not rated."}
        data="Measured from goods receipts (promised vs received date, ordered vs received quantity) and shipment notices for the alert's parts, the action chosen on the alert and the supplier's response. Rules v1 (worker/track/rules.py)."
        provenance="measured" />
    </Card>
  );
}

function TrackItem({ entry, prediction, who }: { entry: TrackEntry; prediction?: ReturnType<typeof predictionAtTheTime>; who: string }) {
  const { alert: a, outcome: o } = entry;
  const k = OUTCOME[o.outcome];
  return (
    <li className="track-item">
      <div className="track-item-head">
        <StatusPill tone={k.tone}>{k.label}</StatusPill>
        <span className="track-item-title">{a.title}</span>
      </div>
      <p className="track-meta">
        {who && <>{who} · </>}Raised {date(a.createdAt)}
        {o.predictedStopDate && <> · stop predicted {date(o.predictedStopDate)}</>}
        {prediction && <> · at the time: {riskWord(prediction.level)}, score {prediction.score}
          {prediction.daysToLineStop != null && <>, line stop in {days(prediction.daysToLineStop)}</>}</>}
      </p>
      {o.evidence.length > 0 && (
        <ul className="track-evidence" aria-label="Evidence">
          {o.evidence.map((ev, i) => (
            <li key={i}>
              <span className="track-evidence-kind">{EVIDENCE_KIND[ev.kind] ?? ev.kind}</span>
              {ev.ref !== "none" && <span className="ks-num">{ev.ref}</span>}
              {ev.date && <span>{date(ev.date)}</span>}
              {ev.note && <span className="track-evidence-note">{ev.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
