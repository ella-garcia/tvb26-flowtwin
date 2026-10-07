"""FlowTwin worker: FastAPI service for Cloud Run. Uses the Supabase service-role key; never expose this service's key to a browser."""
import hmac
import os

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import config
import jobs
import risk_runner
import scheduled
from db import DB

app = FastAPI(title="FlowTwin worker", version="0.1.0")


@app.exception_handler(httpx.HTTPError)
def supabase_unreachable(_req: Request, e: httpx.HTTPError):
    return JSONResponse(status_code=502, content={"detail": f"Supabase unreachable: {type(e).__name__}"})


@app.exception_handler(RuntimeError)
def supabase_error(_req: Request, e: RuntimeError):
    """db.py and the storage download raise RuntimeError for Supabase error responses (the text never holds the key)."""
    if type(e) is not RuntimeError:  # subclasses (NotImplementedError, RecursionError) are our bugs, not Supabase's
        return JSONResponse(status_code=500, content={"detail": f"Internal error: {type(e).__name__}"})
    return JSONResponse(status_code=502, content={"detail": "Supabase request failed", "error": str(e)[:500]})


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = config.worker_token()
    if not expected:
        return  # no token configured: rely on Cloud Run IAM (--no-allow-unauthenticated)
    given = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


def get_db() -> DB:
    try:
        return DB()
    except config.ConfigError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


class RecomputeRequest(BaseModel):
    customer_id: str
    as_of: str | None = None  # ISO date; defaults to app_settings.as_of


@app.get("/health")
def health():
    return {"status": "ok", "supabase_configured": bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))}


@app.post("/jobs/run-next", dependencies=[Depends(require_token)])
def run_next(db: DB = Depends(get_db)):
    """Claim the oldest queued job (atomic queued -> running), run it, mark done/failed. Supabase errors give 502."""
    return jobs.run_next(db)


@app.post("/recompute-risk", dependencies=[Depends(require_token)])
def recompute_risk(req: RecomputeRequest, db: DB = Depends(get_db)):
    """Recompute all risks (and alerts) of one customer right now, outside the queue."""
    try:
        return risk_runner.recompute_customer(db, req.customer_id, req.as_of)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.post("/cron/hourly", dependencies=[Depends(require_token)])
def cron_hourly(db: DB = Depends(get_db)):
    """Called by pg_cron every hour: ingest signals, recompute risk, auto-resolve, notify."""
    return scheduled.run_hourly(db)


@app.post("/jobs/drain", dependencies=[Depends(require_token)])
def jobs_drain(db: DB = Depends(get_db)):
    """Called by pg_cron every 2 minutes: run queued jobs (e.g. uploads) until idle."""
    return scheduled.drain_jobs(db, max_jobs=20)


# ---------------------------------------------------------------- Phase 2 endpoints (filled in by WP5 and WP7)
@app.get("/webhooks/whatsapp")
def whatsapp_verify():
    """Meta webhook verification (hub.challenge). WP5."""
    raise HTTPException(status_code=501, detail="WhatsApp webhook not implemented yet (WP5)")


@app.post("/webhooks/whatsapp")
def whatsapp_webhook():
    """Delivery and read receipts, and BAJA/STOP opt-outs; checked with the app secret, not the worker token. WP5."""
    raise HTTPException(status_code=501, detail="WhatsApp webhook not implemented yet (WP5)")


@app.post("/reply/{token}/extract")
def reply_extract(token: str):
    """Reply page: turn free text or an Excel file into a proposed update; the token is checked server-side. WP7."""
    raise HTTPException(status_code=501, detail="Reply extraction not implemented yet (WP7)")
