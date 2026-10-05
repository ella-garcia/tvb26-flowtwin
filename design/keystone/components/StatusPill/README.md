# StatusPill

A small 28px pill for a record's state. In work lists the `action` pill ("Update") is itself a button that opens the update flow; `fresh` ("Updated") marks a record already current.

**Provide:** `children` (one word), `tone`: `action` | `fresh` | `success` | `warning` | `danger` | `neutral`; `onClick` with `action`.

- Each pill states its meaning in words — never colour alone.
- `fresh` uses `on-fresh` deep-teal text, not white, to pass AA.
- One pill per row, in the "Update" column before the row actions.
