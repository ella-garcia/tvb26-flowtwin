# Button

The command button. `primary` (navy fill) is the one main action of a screen — usually "Buat …" / "Create …" at the head of a toolbar; `secondary` (outlined) is everything else.

**Provide:** `children` (a verb-first label), optional `variant` (`primary` | `secondary`), `size` (`md` 48px default, `sm` 40px), `icon`, and any native button props.

- One `primary` per view. Put it first in the toolbar, left-aligned with the title.
- Labels are sentence case, verb first: "Buat Data Feasibility", "Export".
- A leading `plus` icon only for create actions.
- Disabled buttons drop to 50% opacity; prefer explaining why instead of disabling.
