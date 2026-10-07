"""SMN/CONAGUA municipal forecast web service (official, public, no key).

Documented at https://smn.conagua.gob.mx/es/web-service-api (confirmed 2026-10-05):
  GET https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1   daily forecast per municipality, 4 days (ndia 0..3)
  GET .../?method=3                                                 hourly forecast per municipality, 48 h
The response is a gzip file (served as application/octet-stream) containing a JSON array of ~10,000 records
(about 5 MB uncompressed), one per municipality and day, with string values: ides/nes state, idmun/nmun municipality,
lat, lon, dloc "YYYYMMDDThh" (local day), ndia (day number), prec (mm), probprec (%), raf (gusts km/h), tmax, tmin...
It is refreshed hourly (15 minutes past). There is no polygon or warning data here: warnings (avisos) and cyclone
bulletins are separate products with no documented machine-readable feed (see sources/weather.py); not implemented.

The default live weather source is `weather` (sources/weather.py), which uses this feed for days 1-3 and Open-Meteo
after. This source on its own stays available by name (SIGNAL_SOURCES=...,smn): for each sample point (company
locations) it takes the nearest municipality within MAX_MUNICIPALITY_KM and applies the same heavy-rain rule as
Open-Meteo to the 4-day forecast (so only a run of >= 3 heavy days or one extreme day qualifies). Ids are prefixed
'smn-', source_id 'smn'.
"""
import gzip
import json
from datetime import date

import httpx

from db import DB
from .open_meteo import hav, rain_signals, sample_points

URL = "https://smn.conagua.gob.mx/tools/GUI/webservices/"
TIMEOUT = 90.0
MAX_MUNICIPALITY_KM = 30


def parse_payload(content: bytes) -> list[dict]:
    try:
        content = gzip.decompress(content)
    except OSError:
        pass  # already plain JSON
    return json.loads(content.decode("utf-8"))


def day_of(rec: dict) -> date:
    s = rec["dloc"]
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def municipalities(records: list[dict]) -> list[tuple[float, float, list[dict]]]:
    """(lat, lon, day records) per municipality."""
    by_mun: dict[str, list[dict]] = {}
    for rec in records:
        by_mun.setdefault(f"{rec['ides']}-{rec['idmun']}", []).append(rec)
    return [(float(v[0]["lat"]), float(v[0]["lon"]), v) for v in by_mun.values()]


def nearest_days(muns, pt: dict) -> list[dict] | None:
    """Day records (by ndia) of the municipality nearest to pt, or None if none is within MAX_MUNICIPALITY_KM."""
    near = min(muns, key=lambda m: hav(pt["lat"], pt["lon"], m[0], m[1]), default=None)
    if near is None or hav(pt["lat"], pt["lon"], near[0], near[1]) > MAX_MUNICIPALITY_KM:
        return None
    return sorted(near[2], key=lambda r: int(r["ndia"]))


class SmnConaguaSource:
    name = "smn-conagua"
    source_id = "smn"
    marks_stale = True

    def __init__(self, db: DB | None = None, client: httpx.Client | None = None, companies: list[dict] | None = None,
                 records: list[dict] | None = None):
        self._db, self._client, self._companies, self._records = db, client, companies, records

    def _load(self) -> list[dict]:
        if self._records is not None:
            return self._records
        client = self._client or httpx.Client(timeout=TIMEOUT, follow_redirects=True)
        r = client.get(URL, params={"method": 1})
        r.raise_for_status()
        return parse_payload(r.content)

    def fetch(self) -> list[dict]:
        companies = self._companies if self._companies is not None else (self._db or DB()).select("companies")
        muns = municipalities(self._load())
        rows = []
        for pt in sample_points(companies):
            days = nearest_days(muns, pt)
            if days is None:
                continue
            dates = [day_of(r) for r in days]
            rows += rain_signals(pt, dates, [float(r["prec"]) for r in days], [float(r["probprec"]) for r in days],
                                 [float(r["raf"]) for r in days], source="SMN/CONAGUA municipal forecast",
                                 source_id=self.source_id, id_prefix="smn")
        return rows
