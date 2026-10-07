from .base import SignalSource, mark_stale
from .cbp import CbpSource
from .file import FileSignalSource
from .open_meteo import OpenMeteoSource
from .smn import SmnConaguaSource
from .theft import TheftSource
from .tomtom import TomTomSource
from .weather import WeatherSource


def get_source(name: str, payload: dict | None = None, db=None) -> SignalSource:
    payload = payload or {}
    if name == "file":
        return FileSignalSource(payload.get("path"))
    if name == "weather":
        return WeatherSource(db=db)
    if name in ("open-meteo", "openmeteo"):
        return OpenMeteoSource(db=db)
    if name in ("smn", "conagua", "smn-conagua"):
        return SmnConaguaSource(db=db)
    if name == "tomtom":
        return TomTomSource(db=db)
    if name == "cbp":
        return CbpSource(db=db)
    if name == "theft":
        return TheftSource(payload.get("path"))
    raise ValueError(f"unknown signal source '{name}'")
