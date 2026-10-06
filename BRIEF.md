# FlowTwin v0 — builder brief

**Product:** early warning for automotive supply chains in Mexico. A Tier 1 ("key customer", e.g. QRO Seating Systems in Querétaro)
pays and invites its Tier 2 suppliers for free. Each supplier gets a **risk traffic light** (green / amber / red) that predicts
problems *before* they happen, e.g. a supplier near Veracruz in rainy season: transit goes from 2 to 5 days → alert.

**Facts from our advisor (use in copy, mark as "to validate" where shown):**
- An OEM line stop costs about €15,000 per minute (settings.lineStopCostEurPerMinute). **Internal only: never shown in the UI**
  (professor feedback, Oct 2026: impact does not need to be monetised; see docs/evidence-brief-professor-feedback.md).
- A car has 18–25k parts; one missing screw can stop the line → rank by time to line stop, then part criticality, never by spend or €.
- Delivery history (OTIF) is graded A/B/C against the contract target and shown next to, not inside, the forward-looking risk light.
- **Money rule (Oct 2026):** no money on the risk board, alerts or emails. MXN appears only on the What-if page, built from the
  Tier 1's own data (unit costs it pays, its content value per vehicle) and stated assumptions, always marked estimated.
  The risk board shows the optimization score, lever benefits and line uptime %, never currency.
- Contracts allow ±15% demand changes → "Can this supplier absorb +15%?" (FlexResult) is a headline indicator.
- Contracts include ~3% price cuts a year → suppliers' costs and margins are NEVER visible to the Tier 1.

**Language:** English UI. Mexican place names stay in Spanish. Money: MX$12,000 / €15k. Dates "5 Oct 2026". Use `src/lib/format.ts`.

## Rules for every builder
1. **Only edit files in your assigned folders.** Shared files (src/lib/*, src/app/*, src/keystone/*, src/components/shared.tsx,
   src/packs/*, src/styles/*, src/lib/types.ts) are owned by the lead. If you need a change there, describe it in your final report.
2. **Read data only through `useApp().db`** (src/lib/dataLayer.ts). It enforces sharing. Catch `AccessDeniedError` and show `<NotShared>`.
   Mutate only via `useApp().dispatch(action)` with the actions defined in dataLayer.ts.
3. **Use Keystone components** from `src/keystone` (Button, StatusPill, DataTable, StatCard, FilterChip, IconButton, Breadcrumb, Icon…)
   and shared components from `src/components/shared.tsx` (PageHeader, Card, RiskLight, FormulaSource, NotShared, Empty, ProvenanceTag).
   Read `design/keystone/README.md` and the component READMEs in `design/keystone/components/*/README.md` first.
4. **Styling:** only CSS variables from `src/styles/tokens.css` + `src/styles/app.css` (no literal colours). Page CSS goes in a `.css`
   file inside your page folder, classes prefixed with your folder name. Must work in light and dark themes.
5. Keystone rules: one yellow `accent` highlight per screen at most; status always has a word or ▲/▼, never colour alone;
   sentence-case, verb-first labels; tabular numerals (`ks-num`) for figures; row numbers zero-padded "01".
6. Every calculated figure that matters gets a `<FormulaSource>` (formula, data used, measured/estimated).
   Estimated values are labelled (ProvenanceTag or `.ft-estimated`).
7. Charts: hand-written SVG (no chart library), drawn to scale, colours from tokens (`--projection`, `--cover`, `--primary`, `--ink-subtle`),
   axis labels in `--ink-subtle`, readable in both themes.
8. Check your work: `cd app && npx tsc -b && npx vite build` must pass. Do not start a dev server.
9. Domain types are in `src/lib/types.ts` (see "Early warning" section). Seed lives in `src/data/seed/seed.json`
   (a small starter fixture until the data builder replaces it — code against the types, not the fixture's values).
