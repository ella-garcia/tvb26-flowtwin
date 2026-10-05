# FlowTwin worker

Python service (FastAPI, Cloud Run) that runs the FlowTwin risk engine against the Supabase database with the service-role key.

## What it does
- `GET /health` liveness and whether the two Supabase env vars are set.
- `POST /jobs/run-next` claims the oldest `jobs` row with `status = queued` (conditional update `queued -> running`, so two workers never take the same job), runs it, then sets `done`, or `failed` with the error text.
  - `recompute-risk` (`company_id` = customer, or null for all customers; optional `payload.as_of`): reloads parts, signals and supplier data, recomputes every risk of the customer, upserts `risks`, and creates or refreshes `alerts` for non-green risks. Alert `status`, `chosen_action_id`, `supplier_response` and `actions` of existing alerts are never overwritten.
  - `ingest-signals` (`payload.source` = `file` default, or `smn-conagua`): upserts `signals`, then queues a `recompute-risk` job for all customers. The file source reads `worker/data/seed_signals.json` (or `payload.path` / `SIGNALS_FILE`). The SMN/CONAGUA source is a stub that fails the job with a clear error; TODO notes are in `sources/smn.py`.
  - `parse-upload`, `build-twin`: not implemented; the job is marked `failed` with "not implemented".
- `POST /recompute-risk` body `{"customer_id": "qss", "as_of": "2026-10-05"}` recomputes one customer immediately.

Call `run-next` repeatedly (Cloud Scheduler every minute, or a Supabase database webhook on `jobs` insert) until it returns `{"status": "idle"}`.

## Configuration (environment)
See `.env.example` (no values). `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` required. The service-role key bypasses RLS: keep it in Cloud Run secrets, never in the app bundle or the repo. Optional `WORKER_TOKEN`: if set, the job endpoints require `Authorization: Bearer <token>`; otherwise deploy with `--no-allow-unauthenticated` and use IAM.

## Layout
- `engine/` pure functions on plain dicts in DB column shape (snake_case rows in, risk and alert rows out): `projection.py` (14-day Monte Carlo, cover, exposure), `flex.py` (+15% test), `scoring.py` (drivers, score, traffic light), `alerts.py`, `otif.py`, `profiles.py`, `risk.py` (orchestration).
- `db.py` PostgREST client (httpx), `risk_runner.py` DB glue, `jobs.py` queue, `sources/` signal sources, `main.py` API.
- `data/supplier_profiles.json` static supplier inputs from the v0 seed; `data/seed_signals.json` seeded signals.
- `spikes/isomorph/` ISOMORPH feasibility spike (`FINDINGS.md`).

The engine reproduces `app/src/data/seed/seed.json` exactly (same random seeds, same call order): `tests/test_engine.py` compares every risk and alert.

## Known gaps (need a schema decision)
- The schema has no place for per-supplier lead-time variability, highways, utilisation, ceiling, finished-goods cover, bottleneck name or data status. They come from `data/supplier_profiles.json`, overridden by operating data when present (outbound lane highways, partner lead-time variability, machine utilisation). Recommended: a `supplier_profiles` table. Same for the 12-week OTIF series (synthetic until `kpis` carries OTIF).
- `signals` has no short label column, so driver text uses the full signal title in the DB (the seed uses the short label).
- Alerts of risks that turned green are left open (no auto-resolve); that is a product decision.
- Verified once against the local Supabase stack (seeded): recompute-risk for qss gave hmo red/score 82/line stop in 2 days, edl amber; ingest-signals + chained recompute-risk jobs ran to done. The HTTP layer (uvicorn routes) was smoke-tested only without DB config.

## Run locally
```
cd worker && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...     # in the shell only
.venv/bin/uvicorn main:app --port 8080
curl -X POST localhost:8080/recompute-risk -H 'content-type: application/json' -d '{"customer_id":"qss"}'
```
With the local stack: `supabase start`, then `eval "$(supabase status -o env | sed 's/^/export /')"` and map `API_URL` / `SERVICE_ROLE_KEY` to the two variables.

## Deploy (Cloud Run)
```
gcloud run deploy flowtwin-worker --source worker --region <region> --no-allow-unauthenticated \
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=<secret>:latest --set-env-vars SUPABASE_URL=<url>
```
The container listens on `$PORT`.

## Live signals, notifications and the hourly schedule (Phase 2)
`scheduled.py` exposes two functions for the routes `POST /cron/hourly` and `POST /jobs/drain` (called by pg_cron at :05 every hour and every 2 minutes; see `worker_config` in the intake migration).

`run_hourly(db)`:
1. Ingest every source in `SIGNAL_SOURCES` (default `open-meteo,file`), upsert into `signals` (stable `id`, `source_id`, `external_ref`), and set `active = false` on signals of a live source that its latest successful fetch no longer returns. Nothing is deleted. A source that errors is recorded in the summary and skipped.
2. `risk_runner.recompute_all`.
3. Auto-resolve: alerts of pairs whose risk is now green get `status = 'resolved'`, `resolved_by = 'engine'`; the key customer is told (`auto-resolved`).
4. Notify (email; Resend): `new-alert` and `level-up` (amber to red) to the key customer and the supplier, `supplier-responded` to the key customer. Addresses come from `companies.contact.email`. Every attempt is a row in `alert_notifications`; `(alert, reason, recipient)` is never sent twice. Without `RESEND_API_KEY` the status is `dry-run`.

`drain_jobs(db, max_jobs=20)` runs `jobs.run_next` until the queue is idle.

### Sources
- `sources/open_meteo.py` Open-Meteo forecast (no key), 14 days, one request per 50 company locations (suppliers and key customers). A heavy-rain episode is a run of at least 3 consecutive days with at least 25 mm, or any day of at least 60 mm. Severity and transit multiplier by peak daily rainfall (table `RAIN_BANDS` at the top of the file): 25-40 mm medium x1.3, 40-60 mm high x1.8, 60 mm and over high x2.6; points inside a landslide-prone corridor (`LANDSLIDE_ZONES`, e.g. Orizaba-Puebla on MEX-150D) get at least x2.6 and the corridor's highways. Radius 40 km. Multipliers are hand-set; calibrate against carrier transit-time data.
- `sources/smn.py` SMN/CONAGUA municipal forecast web service (`https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1`, gzip JSON, 4 days, hourly refresh), opt-in with `SIGNAL_SOURCES=...,smn`. Same rain rule on the nearest municipality within 30 km. Warnings (avisos) and cyclone bulletins are not in this service and are not implemented.
- `sources/file.py` the seeded demo signals (never marked inactive by another source).

Tests: `tests/test_sources*.py`, `test_notify*.py`, `test_scheduled*.py` use fakes and mocked HTTP; no network.
