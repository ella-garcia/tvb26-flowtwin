"""Reads seeded signals from a local JSON file: either a list of signals, or an object with a "signals" key
(e.g. app/src/data/seed/seed.json). camelCase keys are mapped to the table's snake_case columns."""
import json

import config

COLUMNS = ("id", "kind", "title", "description", "state", "lat", "lon", "radius_km", "highways", "starts_at", "ends_at",
           "severity", "transit_multiplier", "source", "provenance", "short_label", "source_id", "external_ref", "active",
           "supply_cut_pct", "affects")
RENAME = {"radiusKm": "radius_km", "startsAt": "starts_at", "endsAt": "ends_at", "transitMultiplier": "transit_multiplier",
          "supplyCutPct": "supply_cut_pct"}


def normalise(sig: dict) -> dict:
    row = {RENAME.get(k, k): v for k, v in sig.items()}
    row.setdefault("provenance", "estimated")
    row.setdefault("highways", [])
    row.setdefault("short_label", sig.get("short"))      # the v0 seed calls it `short`
    row.setdefault("source_id", "file")
    row.setdefault("external_ref", row.get("id"))
    row.setdefault("active", True)
    row.setdefault("supply_cut_pct", None)   # supplier-input signals only
    row.setdefault("affects", None)          # policy / supplier-input: who it reaches when not by place
    missing = [c for c in COLUMNS if c not in row]
    if missing:
        raise ValueError(f"signal {row.get('id')} is missing {missing}")
    return {c: row[c] for c in COLUMNS}  # drops v0-only fields such as `short`


class FileSignalSource:
    name = "file"
    source_id = "file"
    marks_stale = False   # the file is a fixed demo set: never retired by another source's run

    def __init__(self, path: str | None = None):
        self.path = path or config.signals_file()

    def fetch(self) -> list[dict]:
        with open(self.path, encoding="utf-8") as f:
            data = json.load(f)
        sigs = data["signals"] if isinstance(data, dict) else data
        return [normalise(s) for s in sigs]
