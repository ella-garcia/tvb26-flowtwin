# SubNav

The second column: the product name, then the steps or pages inside the current rail module.

**Provide:** `items` (`{id, label, icon?, count?}`), `current`, optional `brand` (`["Dashboard", "Keystone"]` — the second word renders bold in `primary`).

- Step lists (no icons) are divided by `border` hairlines and may wrap to two lines — they read as a checklist of the stage.
- Overview lists (with icons) have no dividers; a `count` badge sits right-aligned.
- The current item fills with `surface-selected`; text stays `ink`.
