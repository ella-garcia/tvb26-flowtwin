"""14-day transit projection (Monte Carlo) and per-part cover / line-stop exposure.

Inputs are plain dicts in DB column shape (snake_case). Pure functions: no I/O.
"""
import math
import random
from datetime import date, timedelta

from .geo import hav, hash_seed, pct

HORIZON = 14
RUNS = 500
SHIFT_MIN = 480  # a stoppage is capped at one 8-hour shift
CRIT_W = {"line-stopper": 1.0, "high": 0.4, "normal": 0.05}


def _d(v):
    return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])


def affects(supplier, sig):
    """A signal touches a supplier if within radius_km of it, or they share a highway."""
    near = hav(supplier["lat"], supplier["lon"], sig["lat"], sig["lon"]) <= sig["radius_km"]
    return near or bool(set(supplier.get("highways") or []) & set(sig.get("highways") or []))


def active_on(sig, d):
    return _d(sig["starts_at"]) <= d <= _d(sig["ends_at"])


def multiplier_on(supplier, signals, d):
    m = 1.0
    for sig in signals:
        if affects(supplier, sig) and active_on(sig, d):
            m *= float(sig["transit_multiplier"])
    return m


# ---- route legs (imports: border, customs, port). A supplier without `route` keeps the single-leg rule above unchanged.
# Leg kinds each signal kind can slow down; None = any leg in reach (weather, a supplier's own problem).
SIGNAL_LEGS = {"customs": {"border", "customs"}, "port": {"port", "sea", "customs"}, "road": {"road"},
               "blockade": {"road"}, "theft": {"road"}, "weather": None, "supplier": None}


def leg_hit(leg, sig):
    """A signal slows a leg if the leg kind is one it can affect and the leg is within radius_km or shares a highway."""
    kinds = SIGNAL_LEGS.get(sig["kind"])
    if kinds is not None and leg["kind"] not in kinds:
        return False
    near = hav(leg["lat"], leg["lon"], sig["lat"], sig["lon"]) <= sig["radius_km"]
    return near or bool(set(leg.get("highways") or []) & set(sig.get("highways") or []))


def hit_legs(supplier, sig):
    """Legs a signal slows ([] if none). Without a route: the one implicit road leg, by the single-leg rule."""
    if supplier.get("route"):
        return [leg for leg in supplier["route"] if leg_hit(leg, sig)]
    return [None] if affects(supplier, sig) else []


def leg_multiplier_on(leg, signals, d):
    m = 1.0
    for sig in signals:
        if active_on(sig, d) and leg_hit(leg, sig):
            m *= float(sig["transit_multiplier"])
    return m


def project(customer, supplier, parts, signals, settings, as_of):
    """Return the projection bundle for one (customer, supplier) pair.

    supplier carries the profile fields: lat, lon, highways, lead_time_variability.
    """
    rng = random.Random(hash_seed(customer["id"], supplier["id"], "mc"))
    sigma = 0.6 * supplier["lead_time_variability"]
    days = [as_of + timedelta(days=i) for i in range(HORIZON)]
    route = supplier.get("route")
    if route:
        # Normal transit = sum of the legs; the day's multiplier is the leg multipliers weighted by each leg's normal days.
        normal = round(sum(float(leg["days"]) for leg in route), 1)
        normal = int(normal) if normal == int(normal) else normal  # "4 days", like single-leg suppliers
        leg_m = [[leg_multiplier_on(leg, signals, d) for d in days] for leg in route]
        M = [sum(float(leg["days"]) * lm[i] for leg, lm in zip(route, leg_m)) / normal for i in range(HORIZON)]
        legs = [dict(kind=leg["kind"], label=leg["label"], place=leg["place"], normalDays=float(leg["days"]),
                     expectedDays=round(float(leg["days"]) * sorted(lm)[HORIZON // 2], 1)) for leg, lm in zip(route, leg_m)]
    else:
        km = hav(supplier["lat"], supplier["lon"], customer["lat"], customer["lon"]) * 1.3  # road km ~ 1.3 x straight line
        normal = max(1, math.ceil(km / 400))  # ~1 day per 400 km incl. loading, min 1
        M = [multiplier_on(supplier, signals, d) for d in days]
        legs = [dict(kind="road", label="Road", place=supplier["city"], normalDays=float(normal),
                     expectedDays=round(normal * sorted(M)[HORIZON // 2], 1))]

    proj_t = []  # per-day (P10, P50, P90), independent draws
    for m in M:
        xs = sorted(normal * m * math.exp(sigma * rng.gauss(0, 1)) for _ in range(RUNS))
        proj_t.append((pct(xs, .1), pct(xs, .5), pct(xs, .9)))
    gap_med = [normal * (m - 1) for m in M]  # median extra days vs plan

    zs = [rng.gauss(0, 1) for _ in range(RUNS)]  # one noise draw per run, applied over all 14 days
    cost = settings["line_stop_cost_eur_per_minute"]
    lhd = settings["line_hours_per_day"]
    info = []
    for p in parts:
        c0, crit = float(p["days_of_cover"]), p["criticality"]
        cover_d = [max(0.0, c0 - min(g, i + 1)) for i, g in enumerate(gap_med)]
        tot = 0.0
        for z in zs:
            short = 0.0
            for i, m in enumerate(M):
                gap = max(0.0, normal * m * math.exp(sigma * z) - normal)
                short = max(short, min(gap, i + 1) - c0)
            tot += min(SHIFT_MIN, max(0.0, short) * lhd * 60)
        expo = CRIT_W[crit] * (tot / RUNS) * cost
        stop_day = next((i for i, c in enumerate(cover_d) if c <= 0.05), None) if crit in ("line-stopper", "high") else None
        info.append(dict(part=p, c0=c0, cover_d=cover_d, expo=expo, stop_day=stop_day))

    exposed = max(info, key=lambda x: (round(x["expo"], -3), -x["c0"]))
    exposure = round(exposed["expo"] / 1000) * 1000
    stop_days = [x["stop_day"] for x in info if x["stop_day"] is not None]
    dtls = min(stop_days) if stop_days else None
    # Per part, so a key customer can see which vehicle model a stop would hit.
    part_stops = {x["part"]["id"]: x["stop_day"] for x in info if x["stop_day"] is not None}
    projection = [dict(date=d.isoformat(), transitP10=round(t[0], 1), transitP50=round(t[1], 1), transitP90=round(t[2], 1),
                       coverDays=round(exposed["cover_d"][i], 1)) for i, (d, t) in enumerate(zip(days, proj_t))]
    p50s = sorted(t[1] for t in proj_t)
    return dict(normal=normal, days=days, proj_t=proj_t, exposed=exposed, exposure=exposure, days_to_line_stop=dtls, part_stops=part_stops, legs=legs,
                projection=projection, expected=round(p50s[len(p50s) // 2], 1), worst=round(max(t[2] for t in proj_t), 1),
                min_cover=min(float(p["days_of_cover"]) for p in parts))
