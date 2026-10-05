# DataTable

The work-list table: a bordered `radius-lg` card with a sunken header row, 56px rows divided by hairlines, and a footer for `Pagination`.

**Provide:** `columns` (`{key, label, numeric?, align?, render?}`), `rows` (objects; give each an `id`), optional `footer`.

- Column order: No · name · secondary name · figures · region · status pill · actions.
- Row numbers are zero-padded two digits ("01"). Currency as "Rp 12.000" with tabular figures (`numeric: true`).
- Headers in `column` style, `ink-subtle`; cells in `body`, `ink`.
- Row actions are `IconButton`s in a fixed order; the status column uses `StatusPill`.
- On narrow screens the card scrolls horizontally; never wrap cells.
