# Icon

Line icons drawn for Keystone at 24×24 with a 1.75 stroke, round caps and joins — the outline style of the reference dashboards.

**Provide:** `name` (one of `Icon.names`), optional `size` (default 20; 24 in the rail) and `label` when the icon stands alone without a text label nearby.

- Icons inherit `currentColor`: set colour on the parent (`ink-muted` in tables, `rail-ink` on the rail, `primary` when active).
- Never fill an icon; never mix with another icon family on one screen.
- Decorative by default (`aria-hidden`). Icon-only controls use `IconButton`, which supplies the accessible name.
