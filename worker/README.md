# FlowTwin worker

Python service (FastAPI, Cloud Run) that runs the FlowTwin risk engine against the Supabase database with the service-role key.

## What it does
- `GET /health` liveness and whether the two Supabase env vars are set.
- `POST /jobs/run-next` claims the oldest `jobs` row with `status = queued` (conditional update `queued -> running`, so two workers never take the same job), runs it, then sets `done`, or `failed` with the error text.
  - `recompute-risk` (`company_id` = customer, or null for all customers; optional `payload.as_of`): reloads parts, signals and supplier data, recomputes every risk of the customer, upserts `risks`, and creates or refreshes `alerts` for non-green risks. Alert `status`, `chosen_action_id`, `supplier_response` and `actions` of existing alerts are never overwritten.
  - `ingest-signals` (`payload.source` = `file` default, or any source name below): upserts `signals`, marks vanished signals of a live source inactive (like the hourly run), then queues a `recompute-risk` job for all customers. The file source reads `worker/data/seed_signals.json` (or `payload.path` / `SIGNALS_FILE`).
  - `parse-upload`: parses a Tier 1 upload (`intake/`). Uses `job.company_id` only and refuses jobs whose payload names another company or whose `storage_path` is outside `<company_id>/`.
  - `build-twin`: not implemented; the job is marked `failed` with "not implemented".
  - Phase 2 kinds (`ingest-edi`, `sync-connection`, `evaluate-alerts`, `extract-reply`, `send-digest`) are dispatched to
    `edi/`, `connectors/`, `track/`, `reply_ai/` and `notify/scheduled.py`; until their work package lands they fail
    with "not implemented yet (WPn)". See `docs/phase2-plan-2026-10.md`.
- `POST /recompute-risk` body `{"customer_id": "qss", "as_of": "2026-10-05"}` recomputes one customer immediately.

Call `run-next` repeatedly (Cloud Scheduler every minute, or a Supabase database webhook on `jobs` insert) until it returns `{"status": "idle"}`.

## Configuration (environment)
See `.env.example` (no values). `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` required. The service-role key bypasses RLS: keep it in Cloud Run secrets, never in the app bundle or the repo. Optional `WORKER_TOKEN`: if set, the job endpoints require `Authorization: Bearer <token>`; otherwise deploy with `--no-allow-unauthenticated` and use IAM.

## Layout
- `engine/` pure functions on plain dicts in DB column shape (snake_case rows in, risk and alert rows out): `projection.py` (14-day Monte Carlo, cover, exposure), `flex.py` (+15% test), `scoring.py` (drivers, score, traffic light), `alerts.py`, `otif.py`, `profiles.py`, `risk.py` (orchestration).
- `db.py` PostgREST client (httpx), `risk_runner.py` DB glue, `jobs.py` queue, `sources/` signal sources, `main.py` API.
- `intake/` Tier 1 data: `run_parse_upload` for files, `ingest_rows` for any source that already has field-named rows
  (EDI, ERP, CFDI); both validate and write the same way and tag rows with `source` / `source_ref`.
- Phase 2 stubs: `track/` (risk history, alert outcomes), `edi/`, `connectors/`, `reply_ai/`, `notify/scheduled.py`.
- `data/supplier_profiles.json` static supplier inputs from the v0 seed; `data/seed_signals.json` seeded signals.
- `spikes/isomorph/` ISOMORPH feasibility spike (`FINDINGS.md`).

The engine reproduces `app/src/data/seed/seed.json` exactly (same random seeds, same call order): `tests/test_engine.py` compares every risk and alert.

## Known gaps (need a schema decision)
- The schema has no place for per-supplier lead-time variability, highways, utilisation, ceiling, finished-goods cover, bottleneck name or data status. They come from `data/supplier_profiles.json`, overridden by operating data when present (outbound lane highways, partner lead-time variability, machine utilisation). Recommended: a `supplier_profiles` table. Same for the 12-week OTIF series (synthetic until `kpis` carries OTIF).
- Driver text uses the signal's `short_label` (seeded from the seed's short label), falling back to the full title.
- Verified once against the local Supabase stack (seeded): recompute-risk for qss gave hmo red/score 82/line stop in 2 days, edl amber; ingest-signals + chained recompute-risk jobs ran to done. The HTTP layer (uvicorn routes) was smoke-tested only without DB config.

## Run locally
```
cd worker && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
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
1. Ingest every source in `SIGNAL_SOURCES` (default `weather,tomtom,cbp,theft,file`), upsert into `signals` (stable `id`, `source_id`, `external_ref`), and set `active = false` on signals of a live source that its latest successful fetch no longer returns. Nothing is deleted. A source that errors is recorded in the summary and skipped.
2. `risk_runner.recompute_all`.
3. Auto-resolve: alerts of pairs whose risk is now green get `status = 'resolved'`, `resolved_by = 'engine'`; the key customer is told (`auto-resolved`).
4. Notify (email; Resend): `new-alert` and `level-up` (amber to red) to the key customer and the supplier, `supplier-responded` to the key customer. Addresses come from `companies.contact.email`. Every attempt is a row in `alert_notifications`; `(alert, reason, recipient)` is never sent twice. Without `RESEND_API_KEY` the status is `dry-run`.

`drain_jobs(db, max_jobs=20)` runs `jobs.run_next` until the queue is idle.

### Sources
Every live source has an injectable `client=` (httpx) and a `summary` dict after `fetch()`; multipliers are hand-set
tables at the top of each file, to be calibrated against carrier transit-time data.
- `weather` (`sources/weather.py`, default): one merged forecast per company location. Days 1-3 from the SMN/CONAGUA municipal forecast where a municipality is within 30 km, otherwise and for days 4-14 from Open-Meteo; then the heavy-rain rule below. Ids `wx-<lat>_<lon>-<first day>`, `source_id = weather`. If SMN fails the run uses Open-Meteo alone (noted in `summary`). SMN warnings (avisos) and cyclone bulletins have no documented machine-readable feed (checked 2026-10-07) and are not implemented.
- `open-meteo` (`sources/open_meteo.py`) Open-Meteo forecast (no key), 14 days, one request per 50 company locations. A heavy-rain episode is a run of at least 3 consecutive days with at least 25 mm, or any day of at least 60 mm. Severity and transit multiplier by peak daily rainfall (`RAIN_BANDS`): 25-40 mm medium x1.3, 40-60 mm high x1.8, 60 mm and over high x2.6; points inside a landslide-prone corridor (`LANDSLIDE_ZONES`, e.g. Orizaba-Puebla on MEX-150D) get at least x2.6 and the corridor's highways. Radius 40 km. Still available by name.
- `smn` (`sources/smn.py`) SMN/CONAGUA municipal forecast web service (`https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1`, gzip JSON, 4 days, hourly refresh). Same rule on the nearest municipality within 30 km. Still available by name.
- `tomtom` (`sources/tomtom.py`) TomTom Traffic Incident Details v5 in 90 km boxes around every company, route leg and landslide corridor (at most 40 boxes per run). Road closures, flooding and major lane closures become `road` signals, incidents whose text says blockade/demonstration/bloqueo become `blockade`; highways from the road numbers (`MEX-57D`, `57D`, `Fed. 85D`); kept only on a corridor highway or within 10 km of one of our points. Multiplier by kind and expected duration (`MULTIPLIERS`, < 6 h / < 48 h / longer), `provenance = measured`. Ids `tt-<TomTom id>`. Needs `TOMTOM_API_KEY`; without it no request is made, `fetch()` returns [] with `summary.mode = dry-run` and nothing is marked stale.
- `cbp` (`sources/cbp.py`) US CBP Border Wait Times (`https://bwt.cbp.gov/api/waittimes`, public, no key). For each border leg of a supplier route, the port's commercial standard-lane wait (`PORTS`, `WAIT_BANDS`: 90 min x1.4, 150 min x1.8, 240 min x2.5) becomes a `customs` signal on that leg with a 3 km radius, so it slows the border leg only. Measured, US side only (trucks entering the US; southbound and Mexican customs are not measured). Id `cbp-<place>`.
- `theft` (`sources/theft.py`, table `data/theft_corridors.json`) standing cargo-theft priors per corridor: highways, states, weekdays, hour band, multiplier (1.05-1.15) and the published figure and source per row (Overhaul, SESNSP as reported; `verified` false where second-hand). Each run of risky weekdays in the next 14 days is one `theft` signal, `estimated`, id `theft-<corridor>-<first day>`. No live feed.
- `file` (`sources/file.py`) the seeded demo signals (never marked inactive by another source).
- Announced events (pre-announced blockades, tariff or USMCA `policy` events) are added by an admin on the Signals page through the RPC `admin_upsert_signal` (`source_id = admin`); "Disable" calls `admin_set_signal_active`.

Moving from `open-meteo` to `weather`: rows with `source_id = open-meteo` are not retired by the `weather` source; run
`update signals set active = false where source_id in ('open-meteo', 'smn')` once after switching, or they count twice until they end.

Tests: `tests/test_sources*.py` (fixtures in `tests/fixtures/`), `test_notify*.py`, `test_scheduled*.py` use fakes and mocked HTTP; no network.

## Deploy on Vercel (prototype hosting)
The same FastAPI app runs as a Vercel Python function (`api/index.py`, `vercel.json`). Cloud Run (Dockerfile) stays an option for heavier simulation later.
1. In Vercel, create a **new project** from this repository with **Root Directory `worker`** (keep the app's project separate).
2. Environment variables (Production): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_TOKEN` (a long random string), `APP_URL` (the app's URL). Optional: `RESEND_API_KEY`, `NOTIFY_FROM`, `TOMTOM_API_KEY`, `SIGNAL_SOURCES` (default `weather,tomtom,cbp,theft,file`).
3. Deploy, then check `https://<worker>.vercel.app/health` shows `"supabase_configured": true`.
4. In the Supabase SQL editor, point the scheduler at it:
   ```sql
   update public.worker_config set worker_url = 'https://<worker>.vercel.app', worker_token = '<WORKER_TOKEN>' where id = 1;
   ```
Each request is limited to 60 seconds (`vercel.json`); an hourly run takes about a second at prototype scale.
