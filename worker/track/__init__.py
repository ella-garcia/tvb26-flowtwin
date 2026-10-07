"""Twin track record (WP3, docs/phase2-plan-2026-10.md): daily risk snapshots and alert outcomes.

snapshot(db, as_of) is called by the hourly run after the recompute: one risk_history row per pair per day, and on the
first snapshot of a new day one queued 'evaluate-alerts' job (so evaluation runs daily without touching the scheduler).
evaluate(db, job) runs jobs of kind 'evaluate-alerts': it judges every alert whose predicted stop date has passed
(rules in track/rules.py) and writes alert_outcomes with the evidence.

Misses (a delivery problem with no alert before it) go to missed_events, one row per (customer, supplier, part, date);
a problem with no part (a receipt line without part_id) is returned in the result but not stored.
"""
from datetime import date, datetime, timezone

from . import rules

HISTORY_FIELDS = ("level", "score", "days_to_line_stop", "part_stop_days", "projection", "drivers")
FINAL = ("hit", "prevented", "false-alarm")  # verdicts kept as they are on later runs (unknown/pending are re-checked)


def _as_of(db, as_of=None) -> date:
    if as_of:
        return as_of if isinstance(as_of, date) else date.fromisoformat(str(as_of)[:10])
    rows = db.select("app_settings", {"id": "eq.1"})
    return date.fromisoformat(str(rows[0]["as_of"])[:10]) if rows and rows[0].get("as_of") else date.today()


def snapshot(db, as_of=None) -> dict:
    """Copy every risks row into risk_history for as_of (default app_settings.as_of). Idempotent on the primary key.

    When as_of had no snapshot yet, also queue one 'evaluate-alerts' job (company_id null) for all customers.
    """
    day = _as_of(db, as_of).isoformat()
    first = not db.select("risk_history", {"as_of": f"eq.{day}", "limit": "1"})
    now = datetime.now(timezone.utc).isoformat()
    rows = [{"customer_id": r["customer_id"], "supplier_id": r["supplier_id"], "as_of": day,
             **{k: r.get(k) for k in HISTORY_FIELDS}, "recorded_at": now} for r in db.select("risks")]
    db.upsert("risk_history", rows, "customer_id,supplier_id,as_of")
    queued = False
    if first and rows:
        db.insert("jobs", [{"kind": "evaluate-alerts", "company_id": None, "payload": {"as_of": day, "reason": "daily"}}])
        queued = True
    return {"as_of": day, "rows": len(rows), "first_of_day": first, "queued_evaluate": queued}


def _by(rows, *keys):
    out: dict = {}
    for r in rows:
        out.setdefault(tuple(r.get(k) for k in keys), []).append(r)
    return out


def evaluate(db, job: dict) -> dict:
    """Judge alerts whose predicted stop date is at least 1 day before as_of; write alert_outcomes.

    job.company_id limits the run to one key customer; payload.as_of overrides app_settings.as_of; payload.force
    re-judges alerts that already have a final verdict (hit, prevented, false-alarm).
    """
    payload = job.get("payload") or {}
    today = _as_of(db, payload.get("as_of"))
    cust = job.get("company_id")
    f = {"customer_id": f"eq.{cust}"} if cust else {}
    alerts = db.select("alerts", f)
    receipts = db.select("receipts", f)
    notices = db.select("shipment_notices", f)
    stockouts: list[dict] = []  # no table records stock-outs yet (see rules.py)
    existing = {o["alert_id"]: o for o in db.select("alert_outcomes")}
    history = {(h["customer_id"], h["supplier_id"], str(h["as_of"])[:10]): h for h in db.select("risk_history", f)}
    rec_by_pair, not_by_pair = _by(receipts, "customer_id", "supplier_id"), _by(notices, "customer_id", "supplier_id")

    now = datetime.now(timezone.utc).isoformat()
    out_rows, windows = [], {}
    counts = {k: 0 for k in (*rules.OUTCOMES, "pending")}
    no_prediction = kept = 0
    for a in alerts:
        pair = (a["customer_id"], a["supplier_id"])
        predicted = rules.predicted_stop_date(a, history.get((*pair, str(a.get("created_at"))[:10])))
        if predicted is None:
            no_prediction += 1
            continue
        windows[a["id"]] = rules.window(a, predicted)
        prev = existing.get(a["id"])
        if prev and prev.get("outcome") in FINAL and not payload.get("force"):
            kept += 1
            counts[prev["outcome"]] += 1
            continue
        base = {"alert_id": a["id"], "predicted_stop_date": predicted.isoformat(), "part_ids": list(a.get("part_ids") or []),
                "rule_version": rules.RULE_VERSION, "evaluated_at": now}
        if not rules.is_due(predicted, today):
            outcome, evidence = "pending", []
        else:
            outcome, evidence = rules.judge(a, predicted, rec_by_pair.get(pair, []), not_by_pair.get(pair, []),
                                            stockouts, today)
        counts[outcome] += 1
        out_rows.append({**base, "outcome": outcome, "evidence": evidence})
    db.upsert("alert_outcomes", out_rows, "alert_id")

    misses = rules.find_misses(alerts, receipts, stockouts, today, windows)
    stored = [dict(customer_id=m["customer_id"], supplier_id=m["supplier_id"], part_id=m["part_id"], event_date=m["date"],
                   evidence=m["evidence"], rule_version=rules.RULE_VERSION, detected_at=now) for m in misses if m.get("part_id")]
    if stored:
        db.upsert("missed_events", stored, "customer_id,supplier_id,part_id,event_date")
    return {"as_of": today.isoformat(), "customer_id": cust, "written": len(out_rows), "kept": kept,
            "no_prediction": no_prediction, "outcomes": counts, "misses_found": len(misses), "misses_stored": len(stored), "misses": misses,
            "rule_version": rules.RULE_VERSION}
