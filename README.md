# FlowTwin v0 — early warning

Prototype of the Tier 1 early-warning journey, built with the Keystone design system. Runs on seed data; no logins.

## Run
```
cd app && npm install && npm run dev
```
Open http://localhost:5173. The yellow **Testing** bar switches role (Key customer / Supplier owner / Supplier ops / Admin), company and plan.

## Demo path (about 5 minutes)
1. **Key customer → Risk board**: one supplier at "Act now", soonest line stop in 2 days.
2. **Parts & stock**: every part number with stock here, on the road and at the supplier; 6 run out before their next delivery.
   From the board, "Parts below cover" opens this page filtered to one supplier.
3. Click **Hules y Mangueras de Orizaba**: rainy season pushes transit from 2 to 5 days; 3 days of cover on a line-stopper part; fails the +15% flex test.
4. **Alerts**: choose "Pull the next order forward" → Acknowledge.
5. **Invite**: invite another supplier (sponsored, free for them).
6. Switch role to **Supplier owner** (Estampados del Laja) → **My risk**: the same view the customer sees, and its response to an alert.
7. **Supplier ops → My data**: light onboarding (capacity, lead times, stock, files).

"Reset demo data" in the Testing bar restores the seed.

## Layout
- `app/` — React + TypeScript (Vite). Shared foundation in `src/lib`, `src/app`, `src/keystone`, `src/components`, `src/packs`; pages in `src/pages/<module>`.
- `data-gen/generate_seed.py` — seed data and risk engine (14-day Monte Carlo projection, +15% flex test, scoring). Regenerate with `python3 data-gen/generate_seed.py`.
- `design/keystone/` — the Keystone design system source (tokens, components).
- `BRIEF.md` — conventions for anyone building on this.

## Known limits of v0
- Signals are seeded, not live. The projection is a simple Monte Carlo model, not ISOMORPH yet.
- €15k per minute line-stop cost is from the advisor call and still to validate.
- Supplier-side edits in "My data" are kept for the session only.

## Phase 2 backend (Supabase + worker)
- `supabase/` — migrations (schema, sharing rules, intake, signals, notifications, scheduling), `seed.sql`, RLS tests (`supabase/tests/run.sh`).
- `worker/` — FastAPI service (Vercel function for the prototype; Dockerfile for Cloud Run): risk engine, Tier 1 upload parsing, Open-Meteo/SMN signals, email alerts (Resend; dry-run without a key). Routes: `/health`, `/jobs/run-next`, `/jobs/drain`, `/cron/hourly`, `/recompute-risk`.
- App live mode: set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `app/.env.example`).

### Local development
```
supabase start && supabase db reset && supabase/tests/run.sh
```
Known local issue (CLI v2.108): the storage service expects an index the newer local storage schema dropped, so uploads fail with `42P10`. After each `supabase db reset`, restart storage and add the index (local only; cloud projects are unaffected):
```
docker restart supabase_storage_flowtwin-v0
docker exec supabase_db_flowtwin-v0 psql -U supabase_admin -d postgres -c "create unique index if not exists bucketid_objname on storage.objects (bucket_id, name);"
```
Updating the Supabase CLI should remove the need for this.

### Scheduling in the cloud
pg_cron calls the worker every hour (`/cron/hourly`) and every 2 minutes (`/jobs/drain`) once `public.worker_config` has the worker URL and token:
```sql
update public.worker_config set worker_url = 'https://<your-worker>.run.app', worker_token = '<WORKER_TOKEN>' where id = 1;
```
Run that in the Supabase SQL editor; never commit the token.
