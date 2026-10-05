from typing import Protocol


class SignalSource(Protocol):
    """A feed of external disruption signals. fetch() returns rows in the `signals` table shape (snake_case)."""

    name: str

    def fetch(self) -> list[dict]: ...
