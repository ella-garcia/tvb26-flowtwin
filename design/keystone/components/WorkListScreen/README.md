# WorkListScreen

The canonical Keystone screen, composed from the components: a pattern to copy, not a component to import.

**Layout (desktop, ≥1280px):** `NavRail` (96px) · `SubNav` (336px, `border` on its right edge) · main area with `space-10` gutters.

**Main area, top to bottom:**
1. Header row — `Breadcrumb` left; settings + notifications `IconButton`s and `UserChip` right.
2. Page title in `title` (or a `display` greeting with a `caption` "Updated …" line on an overview), `space-8` below the header.
3. Toolbar — primary `Button`, `FilterChip`s, then `SearchField` pushed right; `space-6` below the title.
4. `DataTable` with `Pagination` in its footer, `space-6` below the toolbar.

The whole app sits in a frame with `radius-xl` corners and `shadow-frame` on `canvas` when shown as a floating window; full-bleed in production.
