"""Job queue: atomic claim of the oldest queued job, dispatch by kind, done/failed bookkeeping."""
import logging
from datetime import datetime, timezone

import config  # noqa: F401
from db import DB
from risk_runner import recompute_all, recompute_customer
from sources import get_source, mark_stale

log = logging.getLogger("flowtwin.jobs")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def claim_next(db: DB, attempts: int = 5) -> dict | None:
    """queued -> running with a conditional update, so two workers never run the same job."""
    for _ in range(attempts):
        rows = db.select("jobs", {"status": "eq.queued", "order": "created_at.asc,id.asc", "limit": "1"})
        if not rows:
            return None
        claimed = db.update("jobs", {"id": rows[0]["id"], "status": "eq.queued"}, {"status": "running", "started_at": now()})
        if claimed:  # empty means another worker won the race: look again
            return claimed[0]
    return None


def run_job(db: DB, job: dict) -> dict:
    kind, payload = job["kind"], job.get("payload") or {}
    if kind == "recompute-risk":
        as_of = payload.get("as_of")
        if job.get("company_id"):
            return recompute_customer(db, job["company_id"], as_of)
        return recompute_all(db, as_of)
    if kind == "parse-upload":
        from intake import run_parse_upload
        return run_parse_upload(db, job)
    if kind == "ingest-signals":
        source = get_source(payload.get("source", "file"), payload, db)
        rows = source.fetch()
        db.upsert("signals", rows, "id")
        stale = mark_stale(db, source.source_id, {r["id"] for r in rows}) if source.marks_stale else 0  # as scheduled.ingest_signals
        db.insert("jobs", [{"kind": "recompute-risk", "company_id": None, "payload": {"reason": "ingest-signals"}}])
        return {"signals_upserted": len(rows), "marked_inactive": stale, "queued": "recompute-risk"}
    if kind == "ingest-edi":
        import edi
        return edi.run(db, job)
    if kind == "sync-connection":
        import connectors
        return connectors.run_sync(db, job)
    if kind == "evaluate-alerts":
        import track
        return track.evaluate(db, job)
    if kind == "extract-reply":
        import reply_ai
        return reply_ai.extract(db, job)
    if kind == "send-digest":
        from notify import scheduled as notify_scheduled
        return notify_scheduled.send_digest(db, job)
    raise NotImplementedError(f"job kind '{kind}' is not implemented in the worker yet")


def run_next(db: DB) -> dict:
    job = claim_next(db)
    if not job:
        return {"status": "idle"}
    try:
        result = run_job(db, job)
        db.update("jobs", {"id": job["id"]}, {"status": "done", "finished_at": now(), "error": None})
        return {"status": "done", "job_id": job["id"], "kind": job["kind"], "result": result}
    except Exception as e:  # noqa: BLE001 - any failure is recorded on the job
        error = f"{type(e).__name__}: {e}"
        mark_failed(db, job["id"], error)
        return {"status": "failed", "job_id": job["id"], "kind": job["kind"], "error": error}


def mark_failed(db: DB, job_id, error: str, attempts: int = 2) -> None:
    """Record the failure; retry once, then log and re-raise so the job is never left `running` without a trace."""
    for attempt in range(1, attempts + 1):
        try:
            db.update("jobs", {"id": job_id}, {"status": "failed", "finished_at": now(), "error": error[:1000]})
            return
        except Exception:  # noqa: BLE001
            log.exception("could not mark job %s failed (attempt %d of %d); job error was: %s", job_id, attempt, attempts, error)
            if attempt == attempts:
                raise
