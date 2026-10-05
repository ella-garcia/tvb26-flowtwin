"""Job queue: atomic claim of the oldest queued job, dispatch by kind, done/failed bookkeeping."""
from datetime import datetime, timezone

import config  # noqa: F401
from db import DB
from risk_runner import recompute_all, recompute_customer
from sources import get_source


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
        db.insert("jobs", [{"kind": "recompute-risk", "company_id": None, "payload": {"reason": "ingest-signals"}}])
        return {"signals_upserted": len(rows), "queued": "recompute-risk"}
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
        db.update("jobs", {"id": job["id"]}, {"status": "failed", "finished_at": now(), "error": f"{type(e).__name__}: {e}"[:1000]})
        return {"status": "failed", "job_id": job["id"], "kind": job["kind"], "error": f"{type(e).__name__}: {e}"}
