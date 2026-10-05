# NavRail

The 96px navy rail down the left edge — the signature of a Keystone screen. A yellow `accent` block holds the monogram at the top; each module is an icon over a 10px label; the current module sits on a white `rail-active` tile.

**Provide:** `items` (`{id, label, icon}` — the project lifecycle stages), `current` (id), optional `monogram` (default "K"), `footer` (`{label, icon}` — Log out).

- One rail per app; it never scrolls horizontally and never collapses below 96px on desktop.
- Labels are one or two short words; two-word labels wrap ("Desain & Konstruksi").
- Order follows the lifecycle, top to bottom; Log out is pinned to the bottom.
