"""US CBP Border Wait Times: commercial-truck waits at the ports our routes cross.

API (public, no key; checked 2026-10-07): GET https://bwt.cbp.gov/api/waittimes returns a JSON array, one object per
crossing: port_number, border ("Mexican Border" | "Canadian Border"), port_name, crossing_name, date ("10/7/2026"),
time, port_status, commercial_vehicle_lanes {maximum_lanes, standard_lanes, FAST_lanes}, each lane group
{update_time ("At 4:00 pm CDT"), operational_status ("no delay" | "delay" | "Lanes Closed" | "Update Pending" | "N/A"),
delay_minutes, lanes_open} with numbers as strings ("" when unknown). Refreshed about hourly by CBP.

For every border leg of a supplier route (sources/corridors.py) the port is looked up in PORTS (by place name); the
first listed crossing with a numeric standard-lane wait is used. A wait at or above a threshold (table below,
hand-set) is one `customs` signal on the border leg's own coordinates with RADIUS_KM small enough to reach only that
leg (the Mexican customs leg of the same route sits farther away), for the day of the reading, `measured`.
Id 'cbp-<place>' is stable; when the wait drops below the threshold the signal is marked inactive.

US side only: CBP measures trucks entering the US (northbound) at US inspection. Southbound flows into Mexico share
the bridges but are not measured, and Mexican customs (aduana) time is not included. The descriptions say so.
"""
import re
import unicodedata
from datetime import date

import httpx

from .corridors import border_legs, load_context

API_URL = "https://bwt.cbp.gov/api/waittimes"
TIMEOUT = 20.0
RADIUS_KM = 3

# ---- thresholds (hand-set, estimated) -------------------------------------------------------------------------
# (standard-lane commercial wait in minutes >=, severity, transit multiplier on the border leg), checked top-down
WAIT_BANDS = [
    (240, "high", 2.5),
    (150, "high", 1.8),
    (90, "medium", 1.4),
]
# Mexican border town in a route leg's place (lower case, no accents) -> CBP crossings for trucks, preferred first
PORTS = {
    "nuevo laredo": [("230404", "Laredo World Trade Bridge"), ("230403", "Laredo Colombia Solidarity Bridge")],
    "colombia": [("230403", "Laredo Colombia Solidarity Bridge")],
    "reynosa": [("230502", "Pharr International Bridge")],
    "matamoros": [("535502", "Brownsville Veterans International Bridge"), ("535503", "Brownsville Los Indios Bridge")],
    "piedras negras": [("230302", "Eagle Pass Bridge II"), ("230301", "Eagle Pass Bridge I")],
    "ciudad acuna": [("230201", "Del Rio International Bridge")],
    "ciudad juarez": [("240203", "El Paso Ysleta (Zaragoza) Bridge"), ("240201", "El Paso Bridge of the Americas")],
    "nogales": [("260402", "Nogales Mariposa")],
    "tijuana": [("250602", "Otay Mesa commercial")],
    "mexicali": [("250301", "Calexico East")],
}
# ---------------------------------------------------------------------------------------------------------------


def _plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def crossings_for(place: str) -> list[tuple[str, str]]:
    p = _plain(place)
    return next((v for k, v in PORTS.items() if k in p), [])


def _int(v):
    try:
        return int(str(v).strip())
    except ValueError:
        return None


def band_for(minutes: int):
    for floor, severity, mult in WAIT_BANDS:
        if minutes >= floor:
            return severity, mult
    return None


def _date(s: str) -> date:
    m, d, y = (int(x) for x in s.split("/"))
    return date(y, m, d)


def fmt_wait(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h} h {m} min" if h else f"{m} min"


def leg_signal(leg: dict, by_port: dict[str, dict]) -> dict | None:
    for number, label in crossings_for(leg["place"]):
        port = by_port.get(number)
        lanes = ((port or {}).get("commercial_vehicle_lanes") or {})
        std = lanes.get("standard_lanes") or {}
        wait = _int(std.get("delay_minutes"))
        if wait is None:
            continue   # no reading at this crossing: try the next one
        band = band_for(wait)
        if band is None:
            return None
        severity, mult = band
        fast = _int((lanes.get("FAST_lanes") or {}).get("delay_minutes"))
        day = _date(port["date"]).isoformat()
        desc = f"US CBP reports a {fmt_wait(wait)} wait for commercial trucks in standard lanes at {label}"
        if std.get("lanes_open"):
            desc += f", {std['lanes_open']} lanes open"
        if fast is not None:
            desc += f", FAST lanes {fmt_wait(fast)}"
        if std.get("update_time"):
            desc += f" ({std['update_time']})"
        desc += (". US side only: CBP measures trucks entering the US; southbound crossings into Mexico and Mexican customs "
                 "(aduana) time are not measured. Transit effect is a hand-set estimate by wait band.")
        slug = re.sub(r"[^a-z0-9]+", "-", _plain(leg["place"])).strip("-")
        return dict(
            id=f"cbp-{slug}", kind="customs", title=f"Truck wait {fmt_wait(wait)} at {label}",
            short_label=f"Border wait, {leg['place']}", description=desc, state="Border (US side)",
            lat=leg["lat"], lon=leg["lon"], radius_km=RADIUS_KM, highways=[], starts_at=day, ends_at=day,
            severity=severity, transit_multiplier=mult, source="US CBP border wait times", provenance="measured",
            source_id="cbp", external_ref=f"{number}:{day}", active=True)
    return None


class CbpSource:
    name = "cbp"
    source_id = "cbp"
    marks_stale = True

    def __init__(self, db=None, client: httpx.Client | None = None, profiles: list[dict] | None = None):
        self._db, self._client, self._profiles = db, client, profiles
        self.summary: dict = {}

    def fetch(self) -> list[dict]:
        _, profiles = load_context(self._db, [], self._profiles)
        legs = border_legs(profiles)
        if not legs:
            self.summary = {"border_legs": 0}
            return []   # no route crosses the border: no request
        client = self._client or httpx.Client(timeout=TIMEOUT)
        r = client.get(API_URL)
        r.raise_for_status()
        by_port = {p["port_number"]: p for p in r.json() if p.get("border") == "Mexican Border"}
        rows = [s for s in (leg_signal(leg, by_port) for leg in legs) if s]
        self.summary = {"border_legs": len(legs), "signals": len(rows),
                        "unmapped": [leg["place"] for leg in legs if not crossings_for(leg["place"])]}
        return rows
