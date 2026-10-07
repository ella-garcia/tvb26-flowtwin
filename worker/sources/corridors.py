"""Where our freight runs: supplier routes and highways (supplier_profiles table, else data/supplier_profiles.json), company
locations and the landslide corridors. Shared by the road, border and theft sources; read-only."""
import json
import os

from db import DB
from .open_meteo import LANDSLIDE_ZONES

_PROFILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "supplier_profiles.json")


def load_profiles(db=None) -> list[dict]:
    """[{supplier_id, highways, route}] from the supplier_profiles table, plus the JSON defaults for suppliers without a row."""
    rows = [dict(supplier_id=r["supplier_id"], highways=r.get("highways") or [], route=r.get("route") or [])
            for r in (db.select("supplier_profiles") if db is not None else [])]
    have = {r["supplier_id"] for r in rows}
    with open(_PROFILES, encoding="utf-8") as f:
        for sid, p in json.load(f).items():
            if sid not in have:
                rows.append(dict(supplier_id=sid, highways=p.get("highways") or [], route=p.get("route") or []))
    return rows


def load_context(db=None, companies: list[dict] | None = None, profiles: list[dict] | None = None):
    """(companies, profiles): the injected lists, else read with db (a new DB() when none is given)."""
    if companies is None or profiles is None:
        db = db if db is not None else DB()
        companies = companies if companies is not None else db.select("companies")
        profiles = profiles if profiles is not None else load_profiles(db)
    return companies, profiles


def corridor_highways(profiles: list[dict]) -> set[str]:
    """Every highway a supplier is on, a route leg uses or a landslide corridor carries."""
    out = set()
    for p in profiles:
        out.update(p["highways"])
        for leg in p["route"]:
            out.update(leg.get("highways") or [])
    for z in LANDSLIDE_ZONES:
        out.update(z[4])
    return out


def corridor_points(profiles: list[dict], companies: list[dict]) -> list[dict]:
    """{name, state, lat, lon} for every company, route leg and landslide corridor (deduplicated to 0.01 degrees)."""
    pts = {}

    def add(name, state, lat, lon):
        pts.setdefault(f"{lat:.2f}_{lon:.2f}", dict(name=name, state=state, lat=float(lat), lon=float(lon)))

    for c in sorted(companies, key=lambda c: c["id"]):
        add(c.get("city") or c["id"], c.get("state") or "", c["lat"], c["lon"])
    for p in profiles:
        for leg in p["route"]:
            add(leg.get("place") or leg.get("label") or "", "", leg["lat"], leg["lon"])
    for z in LANDSLIDE_ZONES:
        add(z[0], "", z[1], z[2])
    return list(pts.values())


def border_legs(profiles: list[dict]) -> list[dict]:
    """Distinct border legs of all routes (place, lat, lon), sorted by place."""
    legs = {}
    for p in profiles:
        for leg in p["route"]:
            if leg.get("kind") == "border":
                legs.setdefault(leg["place"], dict(place=leg["place"], lat=float(leg["lat"]), lon=float(leg["lon"])))
    return [legs[k] for k in sorted(legs)]
