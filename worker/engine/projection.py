"""14-day transit projection (Monte Carlo) and per-part cover / line-stop exposure.

Inputs are plain dicts in DB column shape (snake_case). Pure functions: no I/O.

Two failure paths reach the key customer's cover:
  transit gap = normal x (M - 1), the median extra transit days of the day (signals on the lanes), capped by elapsed days;
  input gap   = days of deliveries the supplier cannot make because of an input shortage (`supplier-input` signals):
                cumulative daily cut (share of deliveries lost) minus the supplier's finished goods of the part, >= 0.
Cover of a part on day i = on-hand cover + pipeline arrived by day i - max(transit gap, input gap), floored at 0.
Pipeline = `in_transit` units arriving on `next_delivery_date` (both known), in days of usage; otherwise none (unknown).
`policy` and `supplier-input` signals never slow transit: they never hit a leg (see slows_transit).
"""
import json
import math
import random
from datetime import date, timedelta

from .geo import hav, hash_seed, pct

HORIZON = 14
RUNS = 500
SHIFT_MIN = 480  # a stoppage is capped at one 8-hour shift
CRIT_W = {"line-stopper": 1.0, "high": 0.4, "normal": 0.05}
# Uncertainty with distance (hand-set, estimated): on days a weather signal drives transit, the P10-P90 spread around P50
# is multiplied by 1 + BAND_WIDEN_PER_DAY x (day - BAND_WIDEN_FROM_DAY) beyond that day (day 0 = as_of).
BAND_WIDEN_FROM_DAY = 3
BAND_WIDEN_PER_DAY = 0.08
# Confidence of each projection day: high up to day 3, medium up to day 7, low after.
CONFIDENCE_HIGH_DAYS = 3
CONFIDENCE_MEDIUM_DAYS = 7
# Signal kinds that never change transit: they act on what the supplier can deliver, or on trade exposure.
NO_TRANSIT_KINDS = {"supplier-input", "policy"}


def _d(v):
    return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])


def affects(supplier, sig):
    """A signal touches a supplier if within radius_km of it, or they share a highway."""
    near = hav(supplier["lat"], supplier["lon"], sig["lat"], sig["lon"]) <= sig["radius_km"]
    return near or bool(set(supplier.get("highways") or []) & set(sig.get("highways") or []))


def active_on(sig, d):
    return _d(sig["starts_at"]) <= d <= _d(sig["ends_at"])


def slows_transit(sig):
    return sig["kind"] not in NO_TRANSIT_KINDS


def affects_list(sig, key):
    """A list from the signal's `affects` (jsonb, camelCase keys; snake_case accepted): supplierIds, originCountries, hsPrefixes."""
    a = sig.get("affects") or {}
    if isinstance(a, str):
        a = json.loads(a)
    snake = "".join("_" + c.lower() if c.isupper() else c for c in key)
    return list(a.get(key) or a.get(snake) or [])


def confidence(i):
    """Confidence of projection day i (0 = as_of)."""
    return "high" if i <= CONFIDENCE_HIGH_DAYS else "medium" if i <= CONFIDENCE_MEDIUM_DAYS else "low"


def band_widen(i):
    """Spread factor for a weather-driven day i: 1 up to BAND_WIDEN_FROM_DAY, then + BAND_WIDEN_PER_DAY per day."""
    return 1 + BAND_WIDEN_PER_DAY * max(0, i - BAND_WIDEN_FROM_DAY)


# ---- supplier input shortage (second failure path)
def input_reaches(supplier, sig):
    """A supplier-input signal reaches a supplier named in affects.supplierIds, or (none named) by place or highway."""
    if sig["kind"] != "supplier-input":
        return False
    ids = affects_list(sig, "supplierIds")
    return supplier["id"] in ids if ids else affects(supplier, sig)


def input_cut_on(supplier, signals, d):
    """Share of the supplier's deliveries lost on day d: 1 - prod(1 - supply_cut_pct) over active input signals reaching it."""
    keep = 1.0
    for sig in signals:
        if input_reaches(supplier, sig) and active_on(sig, d):
            keep *= 1 - min(1.0, max(0.0, float(sig.get("supply_cut_pct") or 0)))
    return 1 - keep


def fg_days_of(part, supplier):
    """Supplier finished goods of this part in days of the key customer's usage: supplier_fg_on_hand / daily_usage when
    the supplier shares it, else the profile's finished-goods days."""
    fg, usage = part.get("supplier_fg_on_hand"), float(part.get("daily_usage") or 0)
    if fg is not None and usage > 0:
        return float(fg) / usage
    return float(supplier.get("fg_days") or 0)


def input_gaps(cuts, fg):
    """Deliveries lost by each day (days of usage, cumulative), after the supplier's finished goods are used up."""
    out, tot = [], 0.0
    for c in cuts:
        tot += c
        out.append(max(0.0, tot - fg))
    return out


def pipeline(part, as_of):
    """(days of usage in transit, arrival day index) when in_transit and next_delivery_date are both known, else (0, None).
    A next delivery date already past counts as arriving on as_of."""
    q, nd, usage = part.get("in_transit"), part.get("next_delivery_date"), float(part.get("daily_usage") or 0)
    if q is None or not nd or usage <= 0:
        return 0.0, None
    return float(q) / usage, max(0, (_d(nd) - as_of).days)


def multiplier_on(supplier, signals, d):
    m = 1.0
    for sig in signals:
        if slows_transit(sig) and affects(supplier, sig) and active_on(sig, d):
            m *= float(sig["transit_multiplier"])
    return m


# ---- route legs (imports: border, customs, port). A supplier without `route` keeps the single-leg rule above unchanged.
# Leg kinds each signal kind can slow down; None = any leg in reach (weather, a supplier's own problem).
SIGNAL_LEGS = {"customs": {"border", "customs"}, "port": {"port", "sea", "customs"}, "road": {"road"},
               "blockade": {"road"}, "theft": {"road"}, "weather": None, "supplier": None}


def leg_hit(leg, sig):
    """A signal slows a leg if the leg kind is one it can affect and the leg is within radius_km or shares a highway."""
    if not slows_transit(sig):
        return False
    kinds = SIGNAL_LEGS.get(sig["kind"])
    if kinds is not None and leg["kind"] not in kinds:
        return False
    near = hav(leg["lat"], leg["lon"], sig["lat"], sig["lon"]) <= sig["radius_km"]
    return near or bool(set(leg.get("highways") or []) & set(sig.get("highways") or []))


def hit_legs(supplier, sig):
    """Legs a signal slows ([] if none). Without a route: the one implicit road leg, by the single-leg rule."""
    if not slows_transit(sig):
        return []
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

    # Days a weather signal drives transit: their P10-P90 spread widens with distance (band_widen).
    weather = [any(s["kind"] == "weather" and float(s["transit_multiplier"]) > 1 and active_on(s, d) and hit_legs(supplier, s)
                   for s in signals) for d in days]
    proj_t = []  # per-day (P10, P50, P90), independent draws
    for i, m in enumerate(M):
        xs = sorted(normal * m * math.exp(sigma * rng.gauss(0, 1)) for _ in range(RUNS))
        p10, p50, p90 = pct(xs, .1), pct(xs, .5), pct(xs, .9)
        if weather[i]:
            f = band_widen(i)
            p10, p90 = max(0.0, p50 - (p50 - p10) * f), p50 + (p90 - p50) * f
        proj_t.append((p10, p50, p90))
    gap_med = [normal * (m - 1) for m in M]  # median extra days vs plan
    cuts = [input_cut_on(supplier, signals, d) for d in days]  # share of deliveries the supplier cannot make, per day

    zs = [rng.gauss(0, 1) for _ in range(RUNS)]  # one noise draw per run, applied over all 14 days
    cost = settings["line_stop_cost_eur_per_minute"]
    lhd = settings["line_hours_per_day"]
    info = []
    for p in parts:
        c0, crit = float(p["days_of_cover"]), p["criticality"]
        pipe, arrive = pipeline(p, as_of)
        piped = [pipe if arrive is not None and i >= arrive else 0.0 for i in range(HORIZON)]
        fg = fg_days_of(p, supplier)
        in_gap = input_gaps(cuts, fg) if any(cuts) else [0.0] * HORIZON
        loss = [max(min(g, i + 1), in_gap[i]) for i, g in enumerate(gap_med)]
        cover_d = [max(0.0, c0 + piped[i] - loss[i]) for i in range(HORIZON)]
        tot = 0.0
        for z in zs:
            short = 0.0
            for i, m in enumerate(M):
                gap = max(0.0, normal * m * math.exp(sigma * z) - normal)
                short = max(short, max(min(gap, i + 1), in_gap[i]) - c0 - piped[i])
            tot += min(SHIFT_MIN, max(0.0, short) * lhd * 60)
        expo = CRIT_W[crit] * (tot / RUNS) * cost
        stop_day = next((i for i, c in enumerate(cover_d) if c <= 0.05), None) if crit in ("line-stopper", "high") else None
        # What empties the cover at the stop day: the input shortage when its gap is larger than the transit gap there.
        cause = None if stop_day is None else ("input" if in_gap[stop_day] > min(gap_med[stop_day], stop_day + 1) else "transit")
        info.append(dict(part=p, c0=c0, cover_d=cover_d, expo=expo, stop_day=stop_day, cause=cause, fg=fg,
                         in_gap=max(in_gap), pipe=pipe, arrive=arrive))

    exposed = max(info, key=lambda x: (round(x["expo"], -3), -x["c0"]))
    exposure = round(exposed["expo"] / 1000) * 1000
    stop_days = [x["stop_day"] for x in info if x["stop_day"] is not None]
    dtls = min(stop_days) if stop_days else None
    # Per part, so a key customer can see which vehicle model a stop would hit.
    part_stops = {x["part"]["id"]: x["stop_day"] for x in info if x["stop_day"] is not None}
    first_stop = min((x for x in info if x["stop_day"] is not None), key=lambda x: x["stop_day"], default=None)
    projection = [dict(date=d.isoformat(), transitP10=round(t[0], 1), transitP50=round(t[1], 1), transitP90=round(t[2], 1),
                       coverDays=round(exposed["cover_d"][i], 1), confidence=confidence(i)) for i, (d, t) in enumerate(zip(days, proj_t))]
    p50s = sorted(t[1] for t in proj_t)
    input_sigs = [s for s in signals if input_reaches(supplier, s) and any(active_on(s, d) for d in days)]
    return dict(normal=normal, days=days, proj_t=proj_t, exposed=exposed, exposure=exposure, days_to_line_stop=dtls, part_stops=part_stops, legs=legs,
                stop_cause=first_stop["cause"] if first_stop else None, cuts=cuts, input_signals=input_sigs,
                projection=projection, expected=round(p50s[len(p50s) // 2], 1), worst=round(max(t[2] for t in proj_t), 1),
                min_cover=min(float(p["days_of_cover"]) for p in parts))
