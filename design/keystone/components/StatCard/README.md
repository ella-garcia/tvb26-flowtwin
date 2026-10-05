# StatCard

A KPI tile for an overview page: label, one large figure, and an optional delta with a direction glyph. (Intentional addition, adapted from the Parrot shot's KPI row in Keystone colours.)

**Provide:** `label`, `value`, optional `icon`, `tone="accent"` for the one figure that leads, `delta` (`{value, direction, caption}`).

- Up to four in a row, equal width, `space-4` apart.
- Only one `accent` card per row. Deltas carry ▲/▼ as well as `success`/`danger` colour.
