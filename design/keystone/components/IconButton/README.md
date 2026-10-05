# IconButton

A 36px square, icon-only button — the row actions (view, edit, download, delete) and header utilities (settings, notifications).

**Provide:** `icon`, `label` (required: becomes the accessible name and tooltip), optional `tone="danger"` for delete, `dot` for an unread marker.

- Row actions always appear in this order: view `eye`, edit `pencil`, download `download`, delete `trash`.
- Delete uses `tone="danger"` and must confirm before acting.
- The `dot` is `accent` yellow: "something new", never an error.
