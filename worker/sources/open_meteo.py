"""Open-Meteo forecast source: heavy-rain signals for every company location (suppliers and key customers).

API: https://api.open-meteo.com/v1/forecast (free, no key). Daily precipitation_sum, precipitation_probability_max and
wind_gusts_10m_max for 14 days; several coordinates per request (comma separated).

Rule: a "rain episode" is a run of consecutive days with precipitation_sum >= RAIN_DAY_MM. It becomes a signal when the
run is >= MIN_RUN_DAYS long, or any day in it reaches EXTREME_DAY_MM. Severity and transit multiplier come from the
episode's peak daily rainfall (table below). Multipliers are hand-set like the v0 seed and need calibration against
carrier transit-time data. Points inside a landslide-prone corridor get at least LANDSLIDE_MULTIPLIER and the
corridor's highways (so suppliers routed over it are affected as well).
"""
import re
from datetime import date

import httpx

from db import DB
from engine.geo import hav  # noqa: F401  (re-exported for smn.py)

API_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 20.0
CHUNK = 50                 # coordinates per request
RADIUS_KM = 40

# ---- thresholds (single table) ------------------------------------------------------------------------------
RAIN_DAY_MM = 25.0         # a "heavy rain day"
MIN_RUN_DAYS = 3           # consecutive heavy days that make an episode a signal
EXTREME_DAY_MM = 60.0      # a single day this wet is a signal on its own
# (peak daily mm >=, severity, transit multiplier), checked top-down
RAIN_BANDS = [
    (60.0, "high", 2.6),
    (40.0, "high", 1.8),
    (25.0, "medium", 1.3),
]
LANDSLIDE_MULTIPLIER = 2.6
# Landslide-prone mountain corridors: (name, lat, lon, radius km, highways)
LANDSLIDE_ZONES = [
    ("Orizaba-Puebla (Cumbres de Maltrata)", 18.85, -97.10, 50, ["MEX-150D"]),
    ("Sierra Norte de Puebla", 20.00, -97.60, 40, ["MEX-132D"]),
]
# ---------------------------------------------------------------------------------------------------------------

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_range(a: date, b: date) -> str:
    if a == b:
        return f"{a.day} {MONTHS[a.month - 1]}"
    if a.month == b.month:
        return f"{a.day}–{b.day} {MONTHS[b.month - 1]}"
    return f"{a.day} {MONTHS[a.month - 1]}–{b.day} {MONTHS[b.month - 1]}"


def band_for(peak_mm: float):
    for floor, severity, mult in RAIN_BANDS:
        if peak_mm >= floor:
            return severity, mult
    return None


def landslide_zone(lat, lon):
    for z in LANDSLIDE_ZONES:
        if hav(lat, lon, z[1], z[2]) <= z[3]:
            return z
    return None


def point_key(lat, lon) -> str:
    return f"{lat:.2f}_{lon:.2f}"


def rain_episodes(dates: list[date], precip: list) -> list[tuple[int, int]]:
    """(first, last) index of each qualifying run of heavy-rain days."""
    out, i, n = [], 0, len(dates)
    p = [x if x is not None else 0.0 for x in precip]
    while i < n:
        if p[i] >= RAIN_DAY_MM:
            j = i
            while j + 1 < n and p[j + 1] >= RAIN_DAY_MM and (dates[j + 1] - dates[j]).days == 1:
                j += 1
            if j - i + 1 >= MIN_RUN_DAYS or max(p[i:j + 1]) >= EXTREME_DAY_MM:
                out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out


def rain_signals(point: dict, dates: list[date], precip: list, prob: list | None, gust: list | None, *,
                 source: str, source_id: str, id_prefix: str) -> list[dict]:
    """Signal rows for one sample point. point = {name, state, lat, lon}. prob/gust are optional context for the text."""
    rows = []
    zone = landslide_zone(point["lat"], point["lon"])
    for i, j in rain_episodes(dates, precip):
        seg = [x or 0.0 for x in precip[i:j + 1]]
        peak, total = max(seg), sum(seg)
        band = band_for(peak)
        if band is None:
            continue
        severity, mult = band
        highways = []
        if zone:
            severity, mult, highways = "high", max(mult, LANDSLIDE_MULTIPLIER), list(zone[4])
        a, b = dates[i], dates[j]
        when = fmt_range(a, b)
        key = point_key(point["lat"], point["lon"])
        ref = f"{key}:{a.isoformat()}"
        p_max = max((x for x in (prob or [])[i:j + 1] if x is not None), default=None)
        g_max = max((x for x in (gust or [])[i:j + 1] if x is not None), default=None)
        desc = (f"Forecast of {j - i + 1} day{'s' if j > i else ''} of heavy rain near {point['name']}: up to {peak:.0f} mm in a day, "
                f"{total:.0f} mm in total")
        if p_max is not None:
            desc += f", rain probability up to {p_max:.0f}%"
        if g_max is not None:
            desc += f", wind gusts up to {g_max:.0f} km/h"
        desc += ". Wet roads and queues can slow trucks"
        desc += (f"; {zone[0]} is landslide-prone, so partial closures are likely." if zone else ".")
        rows.append(dict(
            id=f"{id_prefix}-{ref.replace(':', '-')}", kind="weather", title=f"Heavy rain forecast near {point['name']}, {when}",
            short_label=f"Heavy rain, {point['name']}", description=desc, state=point["state"], lat=point["lat"], lon=point["lon"],
            radius_km=RADIUS_KM, highways=highways, starts_at=a.isoformat(), ends_at=b.isoformat(), severity=severity,
            transit_multiplier=mult, source=source, provenance="measured", source_id=source_id, external_ref=ref, active=True))
    return rows


def sample_points(companies: list[dict]) -> list[dict]:
    """One point per distinct location (rounded to 0.01 degrees); name and state from the first company there."""
    pts = {}
    for c in sorted(companies, key=lambda c: c["id"]):
        pts.setdefault(point_key(c["lat"], c["lon"]), dict(name=c["city"], state=c["state"], lat=round(c["lat"], 2), lon=round(c["lon"], 2)))
    return list(pts.values())


class OpenMeteoSource:
    name = "open-meteo"
    source_id = "open-meteo"
    marks_stale = True

    def __init__(self, db: DB | None = None, client: httpx.Client | None = None, companies: list[dict] | None = None):
        self._db, self._client, self._companies = db, client, companies

    def _companies_list(self):
        if self._companies is not None:
            return self._companies
        db = self._db or DB()
        return db.select("companies")

    def _forecast(self, client, pts: list[dict]) -> list[dict]:
        params = {"latitude": ",".join(str(p["lat"]) for p in pts), "longitude": ",".join(str(p["lon"]) for p in pts),
                  "daily": "precipitation_sum,precipitation_probability_max,wind_gusts_10m_max",
                  "timezone": "America/Mexico_City", "forecast_days": 14}
        r = client.get(API_URL, params=params)
        r.raise_for_status()
        data = r.json()
        data = data if isinstance(data, list) else [data]   # one coordinate returns an object, several return a list
        if len(data) != len(pts):
            raise ValueError(f"Open-Meteo returned {len(data)} locations for {len(pts)} points")
        return data

    def fetch(self) -> list[dict]:
        pts = sample_points(self._companies_list())
        client = self._client or httpx.Client(timeout=TIMEOUT)
        rows = []
        for k in range(0, len(pts), CHUNK):
            chunk = pts[k:k + CHUNK]
            for pt, loc in zip(chunk, self._forecast(client, chunk)):
                d = loc["daily"]
                dates = [date.fromisoformat(x) for x in d["time"]]
                rows += rain_signals(pt, dates, d["precipitation_sum"], d.get("precipitation_probability_max"),
                                     d.get("wind_gusts_10m_max"), source="Open-Meteo forecast", source_id=self.source_id, id_prefix="om")
        return rows
