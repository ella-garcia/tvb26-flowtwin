from typing import Protocol


class SignalSource(Protocol):
    """A feed of external disruption signals. fetch() returns rows in the `signals` table shape (snake_case).

    source_id: value written to signals.source_id. marks_stale: if True, signals of this source that a successful
    fetch no longer returns are set active=false (see mark_stale)."""

    name: str
    source_id: str
    marks_stale: bool

    def fetch(self) -> list[dict]: ...


def mark_stale(db, source_id: str, keep_ids: set[str]) -> int:
    """Set active=false on signals of `source_id` that are active but not in keep_ids. Never deletes. Returns count.

    Call only after a fetch that succeeded in full; a failed fetch must not retire live signals."""
    rows = db.select("signals", {"source_id": f"eq.{source_id}", "active": "eq.true"})
    stale = [r["id"] for r in rows if r["id"] not in keep_ids]
    for sid in stale:
        db.update("signals", {"id": sid}, {"active": False})
    return len(stale)
