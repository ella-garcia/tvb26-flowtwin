"""Twin track record (WP3, docs/phase2-plan-2026-10.md): daily risk snapshots and alert outcomes.

snapshot(db, as_of) is called by the hourly run after the recompute; it is a no-op until WP3 fills it in.
evaluate(db, job) runs jobs of kind 'evaluate-alerts'.
"""


def snapshot(db, as_of=None) -> dict:
    """Write one risk_history row per (customer, supplier) for as_of. WP3."""
    return {"skipped": "not implemented (WP3)"}


def evaluate(db, job: dict) -> dict:
    """Mark alerts whose predicted stop date has passed as hit, prevented, miss, false-alarm or unknown. WP3."""
    raise NotImplementedError("evaluate-alerts is not implemented yet (WP3)")
