Keystone is an operations dashboard system for infrastructure programmes — work lists, approvals and stage tracking across a project's lifecycle. Navy structure, one yellow keystone, and quiet white work surfaces where the data does the talking.

## Principles

- **Structure in navy, work in white.** The `rail` carries orientation; the main area stays `surface` and `surface-raised` so tables read cleanly.
- **One keystone.** `accent` yellow appears once per screen as an anchor: the rail's logo tile, a single highlighted stat, an unread dot. If two things are yellow, one is wrong.
- **Borders, not shadows.** Cards separate with `border` hairlines and `shadow-xs`; only the floating app frame gets `shadow-frame`.
- **Dense but calm.** 56px rows, 48px controls, generous `space-10` gutters. Never cram a second toolbar.

## Content

- Labels are sentence case and verb first: "Buat Data Feasibility", "Export", "Update". Page titles name the stage ("Penyusunan Feasibility Study").
- Write in the user's working language; Keystone ships Bahasa Indonesia domain labels with English UI chrome ("Previous", "Next", "Search") — keep each label in one language.
- Address the user by first name only in the overview greeting: "Welcome back, Rick", followed by "Updated Tue 9 Jul 2024" in `caption`.
- Numbers: currency "Rp 12.000" (Indonesian thousands dot), percentages without a space ("12%"), durations with the unit word ("15 Tahun"). Row numbers zero-padded ("01").
- No emoji. Status is one word in a pill: Update, Updated, Done, Pending, Error, Draft.

## Colour

- Page: `surface` inside the app frame; `canvas` only behind a floating frame.
- Text: `ink` for values and headings, `ink-muted` for secondary text, `ink-subtle` for column headers, placeholders and captions (12px+ only).
- Actions: `primary` fill with `on-primary` text. In dark theme `primary` lightens and `on-primary` flips to navy — always use the token, never literal white.
- Navigation: `rail` with `rail-ink` items; the current item on `rail-active` with `rail-active-ink`. Sub-nav current item on `surface-selected`.
- Status: `fresh` + `on-fresh` for a current record; `success`, `warning`, `danger` text on their `-soft` fills. Status always carries a word or ▲/▼ glyph — never colour alone. `success` and `danger` also differ in lightness.
- Charts: series in order `primary`, `chart-2`, `chart-3`, then `accent` for a single highlighted series.
- Controls whose edge is their only cue (inputs, search) use `border-control` (≥3:1); labelled buttons and chips use `border-strong`; dividers use `border`.

## Type

- Family: Plus Jakarta Sans (Google Fonts, weights 400–700) — a geometric grotesk drawn in Jakarta, matching the clean neutral sans of the reference screens. `components/bundle.css` imports it; outside the bundle, load it from Google Fonts.
- Styles: `display` for the overview greeting, `title` for a work list's page title, `heading` for cards, `brand` for the product name, `nav` for sub-nav items, `body` for cells and paragraphs, `label` for buttons, `column` for table headers, `caption` for meta, `pill` for status, `rail` for rail labels (the only text under 12px), `stat` for KPI figures.
- Figures in tables and stats use tabular numerals (`.ks-num`).

## Space, shape, elevation

- Spacing steps `space-1` (4) to `space-10` (40). Rows: `space-5` vertical cell padding → 56px (`row-height`). Toolbar controls `space-3` apart; title to toolbar `space-6`; sections `space-8`.
- Radii: `radius-sm` pills, `radius-md` controls and nav tiles, `radius-lg` cards, `radius-xl` the app frame, `radius-full` avatars and dots only.
- Layout: `rail-width` 96px · `subnav-width` 336px · fluid main area. Below 1024px the sub-nav collapses into a menu; the rail stays.
- Focus: every control shows `focus-ring` — a solid 2px `primary` ring offset by 2px of surface (≥6:1 in both themes).

## Iconography

- Keystone's own 24×24 line icons (1.75 stroke, round caps), exposed as `Keystone.Icon` — outline only, never filled, colour from `currentColor`.
- For an icon not in the set, use Lucide (same grid and stroke) and set `stroke-width` 1.75.
- Row actions are always view `eye`, edit `pencil`, download `download`, delete `trash`, in that order.

## Logo

- There is no Keystone logo mark yet. The rail's top tile shows the monogram "K" set in Plus Jakarta Sans 700, `on-accent` on `accent`. The header shows "Dashboard **Keystone**" in `brand` with the last word bold `primary`. Replace both when a real mark exists; don't draw a substitute.

## Components

Navigation: `NavRail`, `SubNav`, `Breadcrumb`, `UserChip`. Actions: `Button`, `IconButton`, `FilterChip`. Forms: `SearchField`. Data: `DataTable`, `Pagination`, `StatCard`. Status: `StatusPill`. Foundations: `Icon`. Compose a full screen as `WorkListScreen` shows.
