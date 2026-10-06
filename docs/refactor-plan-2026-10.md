# Refactor plan, Oct 2026 (after professor feedback steps A–C)

Source: three read-only reviews (frontend, worker + seed generator, data contracts), checked by the lead.
Rule for every package: no behaviour change except the listed bug fixes; `seed.json` must stay byte-identical
unless a package says otherwise; `npx tsc -b && npx vite build` and `worker/.venv/bin/python -m pytest -q` pass.

## Work packages (run in parallel, separate worktrees, disjoint files)

### WP1 — Security and intake robustness (worker/intake, worker/jobs.py, worker/main.py, new migration, rls_test.sql)
1. **Cross-tenant job bug (security, confirmed):** the jobs insert policy allows `company_id is null`, and the worker
   takes `payload.company_id` first and never checks the storage path. A signed-in user could make the worker write
   another customer's parts/receipts or read another company's file.
   Fix: policy requires `company_id is not null` for parse-upload; worker refuses jobs where payload company ≠ job company,
   or the storage path does not start with `<company_id>/`. Tests in pytest and rls_test.sql.
2. `reset_demo()` restores only alerts and invites: also restore parts, risks, vehicle programmes, supplier profiles;
   clear receipts / demand releases / companies created by uploads; keep `alert_notifications` so emails are not re-sent.
3. Intake: keep existing contact name/role when a suppliers file only has an email; a new part with no stock yet must
   not produce a false "line stops today" (exclude from risk until stock arrives); clear error instead of KeyError.
4. Jobs: a failing failure-path update must not leave a job `running` forever; map Supabase `RuntimeError` to a clear 502.

### WP2 — One risk engine (data-gen/*, worker/engine/*, worker/tests/test_engine.py, conftest)
1. `generate_seed.py` calls `worker/engine` (compute_pair, run_flex, otif_series, make_alert) instead of its own copy;
   `seed.json` byte-identical after each step (`git diff --exit-code`).
2. Live bug: driver labels use the long signal title because the engine reads `short` and the DB has `short_label`.
   Engine reads `short_label or short or title`; `seed_to_sql` writes `short_label`. (Changes `seed.sql` only.)
3. Remove dead code (unused RNG, pstop, backlogs, re-exports); one camel/snake helper module.

### WP3 — Frontend consolidation (app/src/**)
1. One set of shared pills (data status, alert status, criticality, flex) — today the same status shows different
   colours/words on the board and the supplier page.
2. Shared formatters (`days`, `riskWord`, OTIF delta) instead of copies; `CRIT_ORDER` → `CRIT_RANK`.
3. `useScoped` hook for the repeated load/AccessDenied boilerplate (9 pages).
4. Split `SupplierRiskView` (310 lines) into `components/supplier-risk/*`; extract the board map.
5. Remove dead carbon/scorecard/twin code (types, accessors, reducer actions, remote fetches of empty tables, packs KPIs).
6. Bugs: map shows signals the admin disabled (`active === false`); "+15%" hard-coded instead of the contract setting;
   missing FormulaSource on the score card; supplier headline names the lowest-cover part instead of the part that stops.
7. CSS: shared `ft-*` classes for stat grids, toolbars, selects, muted text; drop unused classes and inline styles.

## Deferred (needs a decision or belongs to D)
- Product/privacy decisions: unit cost shown to suppliers vs "never shared: prices" copy; supplier profile
  (utilisation, bottleneck) visible to the customer even when "public only"; turn off testing mode before real data.
- Risk engine using the pipeline fields (in transit, next delivery) — fold into D (route legs).
- Single source of truth for the schema (generate types/columns from Postgres) — after D, when the schema settles.

## Outcome (merged on professor-feedback)
- WP2 merged at 023f15d, WP1 at d089a08, WP3 at 240227b; post-merge fixes in the following commit.
- Checks: tsc and vite build clean, oxlint 9 existing warnings (none new), pytest 82 passed, seed outputs reproducible
  and seed.json byte-identical to before the refactor, RLS suite passes except 2 upload assertions caused by local test uploads,
  every page smoke-tested in the browser for all four roles.
- Independent review verdict: ship with fixes. Fixed after review: model selector label style, false "line stops today" for
  a new part with no stock and no receipts (risk_runner skips it; a real stock-out still counts).
- Still open: reset_demo() is callable by any signed-in user while testing mode is on, and it leaves `uploads` rows of
  tier1-* kinds; unused Site/Lane/Certification types (may be needed by D); RiskMap and FlexCard read the data layer directly.
