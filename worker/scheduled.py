"""Scheduled work: the hourly cycle (ingest signals -> recompute -> auto-resolve -> notify -> track snapshot ->
reminders, digest and check-ins) and the job drain.

Routes (wired in main.py): POST /cron/hourly -> run_hourly(db); POST /jobs/drain -> drain_jobs(db).
Neither raises on a source or notification error: failures are recorded in the returned summary's `errors`.
"""
import os
from datetime import datetime, timezone

import jobs
import notify
import track
from notify import dispatch
from notify import scheduled as notify_scheduled
from risk_runner import recompute_all
from sources import get_source, mark_stale

DEFAULT_SOURCES = "open-meteo,file"


def enabled_sources() -> list[str]:
    raw = os.environ.get("SIGNAL_SOURCES") or DEFAULT_SOURCES
    return [s.strip() for s in raw.split(",") if s.strip()]


def ingest_signals(db, names: list[str] | None = None, errors: list | None = None) -> dict:
    """Fetch every enabled source, upsert, and mark vanished signals of marks_stale sources inactive (never deletes)."""
    errors = errors if errors is not None else []
    out = {}
    for name in names if names is not None else enabled_sources():
        try:
            src = get_source(name, None, db)
            rows = src.fetch()
            db.upsert("signals", rows, "id")
            stale = mark_stale(db, src.source_id, {r["id"] for r in rows}) if src.marks_stale else 0
            out[name] = {"upserted": len(rows), "marked_inactive": stale}
        except Exception as e:  # noqa: BLE001 - a failing feed must not stop the hourly run
            errors.append({"step": f"ingest:{name}", "error": f"{type(e).__name__}: {e}"[:500]})
            out[name] = {"upserted": 0, "marked_inactive": 0, "error": True}
    return out


def auto_resolve(db, client=None) -> dict:
    """Alerts of pairs whose risk is now green -> status 'resolved', resolved_by 'engine'; customer is told ('auto-resolved')."""
    green = {(r["customer_id"], r["supplier_id"]) for r in db.select("risks") if r["level"] == "green"}
    open_alerts = [a for a in db.select("alerts") if a["status"] != "resolved" and (a["customer_id"], a["supplier_id"]) in green]
    if not open_alerts:
        return {"resolved": 0, "notified": 0}
    companies = {c["id"]: c for c in db.select("companies")}
    existing = dispatch.load_existing(db)
    notified = 0
    for a in open_alerts:
        db.update("alerts", {"id": a["id"]}, {"status": "resolved", "resolved_by": "engine",
                                              "updated_at": datetime.now(timezone.utc).isoformat()})
        notified += len(dispatch.send_for(db, {**a, "status": "resolved"}, "auto-resolved", ("customer",), companies, {}, existing, client))
    return {"resolved": len(open_alerts), "notified": notified}


def run_hourly(db, as_of=None, client=None) -> dict:
    errors: list = []
    summary: dict = {"started_at": datetime.now(timezone.utc).isoformat(), "errors": errors}
    summary["signals"] = ingest_signals(db, errors=errors)
    try:
        before = {a["id"]: {"level": a["level"], "status": a["status"]} for a in db.select("alerts")}
    except Exception as e:  # noqa: BLE001
        before = {}
        errors.append({"step": "snapshot", "error": f"{type(e).__name__}: {e}"[:500]})
    try:
        res = recompute_all(db, as_of)
        summary["recompute"] = {"customers": len(res["customers"]),
                                "alerts_created": sum(c["alerts_created"] for c in res["customers"]),
                                "alerts_updated": sum(c["alerts_updated"] for c in res["customers"])}
    except Exception as e:  # noqa: BLE001
        errors.append({"step": "recompute", "error": f"{type(e).__name__}: {e}"[:500]})
        summary["recompute"] = {"error": True}
        summary["finished_at"] = datetime.now(timezone.utc).isoformat()
        return summary  # alerts and notifications would act on stale risks
    for step, fn in (("auto_resolve", lambda: auto_resolve(db, client)),
                     ("notify", lambda: notify.notify_after_recompute(db, before, client)),
                     ("track", lambda: track.snapshot(db, as_of)),                          # WP3
                     ("notify_scheduled", lambda: notify_scheduled.run(db, None, client))):  # WP5
        try:
            summary[step] = fn()
        except Exception as e:  # noqa: BLE001
            errors.append({"step": step, "error": f"{type(e).__name__}: {e}"[:500]})
            summary[step] = {"error": True}
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    return summary


def drain_jobs(db, max_jobs: int = 20) -> dict:
    """Run queued jobs one by one until the queue is idle or max_jobs have run."""
    results = []
    for _ in range(max_jobs):
        res = jobs.run_next(db)
        if res.get("status") == "idle":
            return {"ran": len(results), "idle": True, "jobs": results}
        results.append({k: res.get(k) for k in ("job_id", "kind", "status", "error") if res.get(k) is not None})
    return {"ran": len(results), "idle": False, "jobs": results}
