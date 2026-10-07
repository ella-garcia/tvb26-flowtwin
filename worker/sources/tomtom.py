"""TomTom Traffic Incident Details (v5): road closures and blockades on our freight corridors.

API (checked 2026-10-07, https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/incident-details):
  GET https://api.tomtom.com/traffic/services/5/incidentDetails?key=&bbox=minLon,minLat,maxLon,maxLat&fields=&language=
      &categoryFilter=&timeValidityFilter=present,future
  bbox at most 10,000 km². Response {"incidents": [{"type": "Feature", "geometry": {"type": "Point"|"LineString",
  "coordinates"}, "properties": {id, iconCategory, magnitudeOfDelay, events[{description, code, iconCategory}],
  startTime, endTime, from, to, length (m), delay (s), roadNumbers, timeValidity, probabilityOfOccurrence}}]}.
  iconCategory: 0 unknown, 1 accident, 2 fog, 3 dangerous conditions, 4 rain, 5 ice, 6 jam, 7 lane closed,
  8 road closed, 9 road works, 10 wind, 11 flooding, 14 broken-down vehicle. magnitudeOfDelay: 0 unknown, 1 minor,
  2 moderate, 3 major, 4 undefined (closures).

Boxes: one square of BOX_KM per side around every company, route leg and landslide corridor (sources/corridors.py),
merged on a grid, at most MAX_BOXES per run (free tier: 2,500 requests a day; 40 boxes hourly is 960).
Kept: blockades (any category whose event text says blockade/demonstration/bloqueo...), road closures, flooding and
major lane closures, on a corridor highway or within RADIUS_KM of one of our points. Jams, accidents and works are
too short-lived for a daily engine and are dropped. Highways come from the road numbers ("MEX-57D", "57D", "Fed. 57").

The incident is measured (provenance 'measured'); its transit multiplier is a hand-set estimate (table below) by kind
and expected duration, to be calibrated against carrier transit-time data. Ids are 'tt-<TomTom id>' (stable while
TomTom keeps the incident). Without TOMTOM_API_KEY the source makes no request, returns [] and summary says dry-run;
it then does not mark anything stale either.
"""
import logging
import math
import os
import re
from datetime import datetime, timedelta, timezone

import httpx

from engine.geo import hav
from .corridors import corridor_highways, corridor_points, load_context

log = logging.getLogger("flowtwin.sources.tomtom")

API_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
TIMEOUT = 20.0
BOX_KM = 90            # side of each box: 90 x 90 = 8,100 km² (< 10,000 km² limit)
MAX_BOXES = 40
RADIUS_KM = 10         # a signal reaches suppliers and legs this close, and every supplier on its highways
CATEGORY_FILTER = "3,6,7,8,11"     # dangerous conditions, jam (blockades are often reported as these), lane/road closed, flooding
FIELDS = ("{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,"
          "iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,probabilityOfOccurrence}}}")
LOCAL = timezone(timedelta(hours=-6))   # central Mexico (no DST since 2022)

# ---- transit multipliers (hand-set, estimated) ---------------------------------------------------------------
# kind -> (signal kind, label, multiplier if expected to last < 6 h, < 48 h, >= 48 h)
MULTIPLIERS = {
    "blockade":    ("blockade", "Blockade", 1.5, 2.0, 2.5),
    "closure":     ("road", "Road closed", 1.3, 1.6, 2.0),
    "flooding":    ("road", "Flooding", 1.3, 1.6, 2.0),
    "lane-closed": ("road", "Lane closed", 1.05, 1.1, 1.2),   # only with a major or undefined delay
}
DEFAULT_HOURS = 24     # expected duration when TomTom gives no end time
BLOCKADE_WORDS = re.compile(r"blockade|bloqueo|demonstration|protest|manifestaci|marcha|march\b|toma de caseta", re.I)
# ---------------------------------------------------------------------------------------------------------------

MEX_ROAD = re.compile(r"^(?:MEX|MX|FED(?:ERAL)?|CARR(?:ETERA)?(?:\.?\s*FED(?:ERAL)?)?)?\.?\s*-?\s*(\d{1,3})\s*-?\s*(D)?$")
US_ROAD = re.compile(r"^(I|US)\s*-?\s*(\d{1,3})$")


def parse_highways(numbers) -> list[str]:
    """TomTom road numbers -> our highway names: 'MEX-57D', '57D', 'Fed. 57' -> MEX-57D / MEX-57; 'I-35' kept."""
    out = []
    for n in numbers or []:
        s = str(n).upper().strip()
        m = US_ROAD.match(s)
        if m:
            hw = f"{m.group(1)}-{m.group(2)}"
        else:
            m = MEX_ROAD.match(s)
            if not m:
                continue
            hw = f"MEX-{int(m.group(1))}{m.group(2) or ''}"
        if hw not in out:
            out.append(hw)
    return out


def boxes(points: list[dict]) -> list[tuple[float, float, float, float]]:
    """(minLon, minLat, maxLon, maxLat) of BOX_KM around each point, one per half-box grid cell, at most MAX_BOXES."""
    half_lat = BOX_KM / 2 / 111.0
    cells = {}
    for p in sorted(points, key=lambda p: (p["lat"], p["lon"])):
        g = (round(p["lat"] / half_lat), round(p["lon"] / half_lat))
        cells.setdefault(g, p)
    out = []
    for p in list(cells.values())[:MAX_BOXES]:
        half_lon = BOX_KM / 2 / (111.0 * math.cos(math.radians(p["lat"])))
        out.append((round(p["lon"] - half_lon, 4), round(p["lat"] - half_lat, 4), round(p["lon"] + half_lon, 4), round(p["lat"] + half_lat, 4)))
    return out


def classify(props: dict) -> str | None:
    """Our incident kind (a key of MULTIPLIERS) or None to drop it."""
    text = " ".join(e.get("description") or "" for e in props.get("events") or [])
    if BLOCKADE_WORDS.search(text):
        return "blockade"
    cat, mag = props.get("iconCategory"), props.get("magnitudeOfDelay") or 0
    if cat == 8:
        return "closure"
    if cat == 11 and mag >= 2:
        return "flooding"
    if cat == 7 and mag >= 3:
        return "lane-closed"
    return None


def _time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def multiplier_for(kind: str, hours: float) -> float:
    _, _, short, day, long = MULTIPLIERS[kind]
    return short if hours < 6 else day if hours < 48 else long


def _anchor(geometry: dict) -> tuple[float, float]:
    """(lat, lon) of a Point, or the middle vertex of a LineString."""
    c = geometry["coordinates"]
    if geometry.get("type") == "Point":
        return float(c[1]), float(c[0])
    lon, lat = c[len(c) // 2]
    return float(lat), float(lon)


def incident_signal(inc: dict, points: list[dict], highways: set[str], now: datetime) -> dict | None:
    props = inc.get("properties") or {}
    kind = classify(props)
    if kind is None or not props.get("id"):
        return None
    lat, lon = _anchor(inc["geometry"])
    hws = parse_highways(props.get("roadNumbers"))
    near = min(points, key=lambda p: hav(lat, lon, p["lat"], p["lon"]), default=None)
    near_km = hav(lat, lon, near["lat"], near["lon"]) if near else float("inf")
    if not (set(hws) & highways) and near_km > RADIUS_KM:
        return None   # not on our corridors
    start = _time(props.get("startTime")) or now
    end = _time(props.get("endTime")) or max(start, now) + timedelta(hours=DEFAULT_HOURS)
    hours = max(0.0, (end - max(start, now)).total_seconds() / 3600)
    mult = multiplier_for(kind, hours)
    sig_kind, label = MULTIPLIERS[kind][:2]
    road = ", ".join(hws) or (props.get("roadNumbers") or [None])[0] or "a road"
    stretch = " to ".join(x for x in (props.get("from"), props.get("to")) if x)
    events = "; ".join(e["description"] for e in props.get("events") or [] if e.get("description"))
    desc = f"TomTom reports: {events or label}" + (f" on {road}" if hws else "") + (f", {stretch}" if stretch else "") + "."
    if props.get("length"):
        desc += f" Affects {props['length'] / 1000:.1f} km"
        desc += f", current delay {round(props['delay'] / 60)} min." if props.get("delay") else "."
    desc += (f" Expected until {end.astimezone(LOCAL):%d %b %H:%M}." if props.get("endTime") else
             f" No end time given; assumed {DEFAULT_HOURS} h.")
    desc += " Transit effect is a hand-set estimate by incident type and expected duration."
    ext = str(props["id"])
    return dict(
        id="tt-" + re.sub(r"[^A-Za-z0-9]+", "-", ext)[:80], kind=sig_kind,
        title=f"{label} on {road}" + (f" near {near['name']}" if near and near_km <= 50 and near["name"] else ""),
        short_label=f"{label}, {road}", description=desc, state=(near or {}).get("state") or "",
        lat=round(lat, 4), lon=round(lon, 4), radius_km=RADIUS_KM, highways=hws,
        starts_at=start.astimezone(LOCAL).date().isoformat(), ends_at=end.astimezone(LOCAL).date().isoformat(),
        severity="high" if mult >= 1.8 else "medium" if mult >= 1.3 else "low", transit_multiplier=mult,
        source="TomTom traffic incidents", provenance="measured", source_id="tomtom", external_ref=ext, active=True)


class TomTomSource:
    name = "tomtom"
    source_id = "tomtom"
    marks_stale = True

    def __init__(self, db=None, client: httpx.Client | None = None, companies: list[dict] | None = None,
                 profiles: list[dict] | None = None, api_key: str | None = None, now: datetime | None = None):
        self._db, self._client, self._companies, self._profiles = db, client, companies, profiles
        self._key = api_key if api_key is not None else os.environ.get("TOMTOM_API_KEY", "")
        self._now = now
        self.summary: dict = {}
        if not self._key:
            self.marks_stale = False   # dry-run: leave current road signals alone

    def _get(self, client, bbox) -> list[dict]:
        params = {"key": self._key, "bbox": ",".join(str(x) for x in bbox), "fields": FIELDS, "language": "en-GB",
                  "categoryFilter": CATEGORY_FILTER, "timeValidityFilter": "present,future"}
        try:
            r = client.get(API_URL, params=params)
            r.raise_for_status()
        except httpx.HTTPStatusError as e:   # never let the URL (with the key) reach logs or the run summary
            raise RuntimeError(f"TomTom incidentDetails returned {e.response.status_code}") from None
        except httpx.HTTPError as e:
            raise RuntimeError(f"TomTom incidentDetails request failed: {type(e).__name__}") from None
        return r.json().get("incidents") or []

    def fetch(self) -> list[dict]:
        if not self._key:
            self.summary = {"mode": "dry-run", "reason": "TOMTOM_API_KEY is not set"}
            log.info("tomtom: dry-run (no TOMTOM_API_KEY), no request made")
            return []
        companies, profiles = load_context(self._db, self._companies, self._profiles)
        points, highways = corridor_points(profiles, companies), corridor_highways(profiles)
        now = self._now or datetime.now(timezone.utc)
        client = self._client or httpx.Client(timeout=TIMEOUT)
        rows, seen, bxs = [], set(), boxes(points)
        for bbox in bxs:
            for inc in self._get(client, bbox):
                sig = incident_signal(inc, points, highways, now)
                if sig and sig["id"] not in seen:   # an incident can sit in two overlapping boxes
                    seen.add(sig["id"])
                    rows.append(sig)
        self.summary = {"mode": "live", "boxes": len(bxs), "signals": len(rows)}
        return rows
