# FlowTwin v0 — early warning

Prototype of the Tier 1 early-warning journey, built with the Keystone design system. Runs on seed data; no logins.

## Run
```
cd app && npm install && npm run dev
```
Open http://localhost:5173. The yellow **Testing** bar switches role (Key customer / Supplier owner / Supplier ops / Admin), company and plan.

## Demo path (about 5 minutes)
1. **Key customer → Risk board**: one supplier at "Act now", soonest line stop in 2 days.
2. Click **Hules y Mangueras de Orizaba**: rainy season pushes transit from 2 to 5 days; 3 days of cover on a line-stopper part; fails the +15% flex test.
3. **Alerts**: choose "Pull the next order forward" → Acknowledge.
4. **Invite**: invite another supplier (sponsored, free for them).
5. Switch role to **Supplier owner** (Estampados del Laja) → **My risk**: the same view the customer sees, and its response to an alert.
6. **Supplier ops → My data**: light onboarding (capacity, lead times, stock, files).

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
