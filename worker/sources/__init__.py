from .base import SignalSource, mark_stale
from .file import FileSignalSource
from .open_meteo import OpenMeteoSource
from .smn import SmnConaguaSource


def get_source(name: str, payload: dict | None = None, db=None) -> SignalSource:
    payload = payload or {}
    if name == "file":
        return FileSignalSource(payload.get("path"))
    if name in ("open-meteo", "openmeteo"):
        return OpenMeteoSource(db=db)
    if name in ("smn", "conagua", "smn-conagua"):
        return SmnConaguaSource(db=db)
    raise ValueError(f"unknown signal source '{name}'")
