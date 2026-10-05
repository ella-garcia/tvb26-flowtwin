from .base import SignalSource
from .file import FileSignalSource
from .smn import SmnConaguaSource


def get_source(name: str, payload: dict | None = None) -> SignalSource:
    payload = payload or {}
    if name == "file":
        return FileSignalSource(payload.get("path"))
    if name in ("smn", "conagua", "smn-conagua"):
        return SmnConaguaSource()
    raise ValueError(f"unknown signal source '{name}'")
