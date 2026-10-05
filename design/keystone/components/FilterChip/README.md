# FilterChip

A toolbar chip for filters: an applied filter shows its value with a remove ×; "More filters" opens the filter panel.

**Provide:** `children` (the filter's value), `onRemove` for an applied filter, or `onClick` + `icon="filter"` for the opener.

- Sits right of the primary button, `space-3` apart, same 48px height.
- Applied chips read as the value alone ("All data", "Jawa Barat"), not "Region: …".
