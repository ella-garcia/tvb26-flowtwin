"""Load-consolidation (milk-run) planner for one key customer.

Built only from the customer's own demand (the transport footprints, which come from its parts' daily usage) and the
supplier locations, so it never uses a supplier's lanes, costs or other private data.

Heuristic (Clarke-Wright savings, with a resilience guard):
 1. Candidates: suppliers with a footprint and a fill rate below 0.8 (their trucks run part-empty).
 2. Excluded (listed in totals.excluded, never consolidated): a red light ("At risk now: red light") or a line stop expected
    within the 14-day projection ("Line stop expected in N days"). Their deliveries must not be changed while at risk.
 3. Two suppliers can share a loop only if they are within `milkrun_radius_km` of each other (straight line) AND their bearings
    from the plant differ by at most 35 degrees (they are in the same direction). A merged loop needs every pair compatible.
 4. Start with one loop per supplier. For every compatible pair compute the saving s = d(plant,i) + d(plant,j) - d(i,j)
    (road km = straight line x 1.3; the plant legs use the footprint's road km). Take pairs by descending saving and merge
    the two loops when i and j are the ends of different loops, the pair is compatible, and the merged load fits the trucks.
 5. Resilience guard: a loop runs at least as often as its most frequent member does today
    (deliveriesPerWeek = max of the members' current trucks per week), never less, so no member's cover days shrink.
    The merged weekly pallets must fit in deliveriesPerWeek trucks of `pallets_per_truck` (capacity respected), so
    trucksAfter = max(ceil(sum pallets / capacity), deliveriesPerWeek) = deliveriesPerWeek.
 6. kmAfter = trucksAfter x loop distance, where the loop is plant -> first -> ... -> last -> plant (one round trip per
    delivery, the farthest member first). A loop is kept only if kmAfter < kmBefore (truck-km per week, round trips as in the footprints).
 7. CO2e uses the same emission factor as the footprints; every figure is an estimate. Output is deterministic: candidates
    are sorted by id, ties break on ids, loops are ordered by km saved (then member ids) and numbered loop-1, loop-2, ...

Returns {loops, totals}, shaped like the app's ConsolidationPlan minus customerId and generatedAt (the caller adds them).
"""
import math

from .circular import DEFAULT_FACTOR, DEFAULT_PALLETS_PER_TRUCK, ROAD_FACTOR
from .geo import hav

FILL_LIMIT = 0.8
MAX_BEARING_DIFF = 35.0
DEFAULT_RADIUS_KM = 120.0


def bearing(lat1, lon1, lat2, lon2):
    """Initial compass bearing in degrees (0 = north) from point 1 to point 2."""
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _angle_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def _risk_get(r, snake, camel):
    return r.get(snake, r.get(camel))


def exclusion_reason(risk):
    """Why a supplier at risk must not be touched, or None."""
    if not risk:
        return None
    if risk.get("level") == "red":
        return "At risk now: red light"
    dtls = _risk_get(risk, "days_to_line_stop", "daysToLineStop")
    if dtls is not None:
        return f"Line stop expected in {int(dtls)} days"
    return None


def plan_consolidation(customer, suppliers_by_id, footprints_by_supplier, risks_by_supplier, settings, factor=None):
    factor = factor or DEFAULT_FACTOR
    per_km = float(factor["value"])
    cap = float(settings.get("pallets_per_truck") or DEFAULT_PALLETS_PER_TRUCK)
    radius = float(settings.get("milkrun_radius_km") or DEFAULT_RADIUS_KM)
    lat0, lon0 = customer["lat"], customer["lon"]

    cands, excluded = [], []
    for sid in sorted(footprints_by_supplier):
        fp = footprints_by_supplier[sid]
        if not fp or sid not in suppliers_by_id or not fp.get("trucksPerWeek") or fp["fillRate"] >= FILL_LIMIT:
            continue
        reason = exclusion_reason(risks_by_supplier.get(sid))
        if reason:
            excluded.append(dict(supplierId=sid, reason=reason))
        else:
            cands.append(sid)

    def pos(s):
        return suppliers_by_id[s]["lat"], suppliers_by_id[s]["lon"]

    def d_pair(a, b):
        return hav(*pos(a), *pos(b)) * ROAD_FACTOR

    def d_plant(s):
        return float(footprints_by_supplier[s]["roadKm"])

    brg = {s: bearing(lat0, lon0, *pos(s)) for s in cands}

    def compatible(a, b):
        return hav(*pos(a), *pos(b)) <= radius and _angle_diff(brg[a], brg[b]) <= MAX_BEARING_DIFF

    def freq(members):
        return max(int(footprints_by_supplier[m]["trucksPerWeek"]) for m in members)

    def pallets(members):
        return sum(float(footprints_by_supplier[m]["palletsPerWeek"]) for m in members)

    def fits(members):
        return pallets(members) <= freq(members) * cap + 1e-9

    pairs = sorted(((d_plant(a) + d_plant(b) - d_pair(a, b), a, b) for i, a in enumerate(cands) for b in cands[i + 1:] if compatible(a, b)),
                   key=lambda t: (-t[0], t[1], t[2]))
    routes = {s: [s] for s in cands}            # supplier -> the route list it belongs to (shared list object)
    for saving, a, b in pairs:
        if saving <= 0:
            continue
        ra, rb = routes[a], routes[b]
        if ra is rb or a not in (ra[0], ra[-1]) or b not in (rb[0], rb[-1]):
            continue
        if not all(compatible(x, y) for x in ra for y in rb) or not fits(ra + rb):
            continue
        ra = ra if ra[-1] == a else ra[::-1]     # a at the tail, b at the head of the other route
        rb = rb if rb[0] == b else rb[::-1]
        merged = ra + rb
        for m in merged:
            routes[m] = merged

    loops, seen = [], set()
    for s in cands:
        r = routes[s]
        if id(r) in seen or len(r) < 2:
            continue
        seen.add(id(r))
        seq = list(r) if d_plant(r[0]) >= d_plant(r[-1]) else r[::-1]  # farthest end first, so the loop works back to the plant
        dist = d_plant(seq[0]) + sum(d_pair(a, b) for a, b in zip(seq, seq[1:])) + d_plant(seq[-1])
        f = freq(seq)
        trucks_after = max(math.ceil(pallets(seq) / cap - 1e-9), f)
        km_after = trucks_after * dist
        fps = [footprints_by_supplier[m] for m in seq]
        km_before = sum(fp["truckKmPerWeek"] for fp in fps)
        if not km_after < km_before:
            continue
        trucks_before = sum(fp["trucksPerWeek"] for fp in fps)
        loops.append(dict(members=seq, trucksBefore=trucks_before, trucksAfter=trucks_after,
                          kmBefore=round(km_before, 1), kmAfter=round(km_after, 1),
                          fillBefore=round(pallets(seq) / (trucks_before * cap), 3), fillAfter=round(pallets(seq) / (trucks_after * cap), 3),
                          co2eBeforeKg=round(sum(fp["co2ePerWeekKg"] for fp in fps), 1), co2eAfterKg=round(km_after * per_km, 1),
                          deliveriesPerWeek=f, provenance="estimated"))
    loops.sort(key=lambda l: (-(l["kmBefore"] - l["kmAfter"]), l["members"]))
    for i, l in enumerate(loops, 1):
        l["id"] = f"loop-{i}"
    loops = [dict(id=l["id"], **{k: v for k, v in l.items() if k != "id"}) for l in loops]
    totals = dict(trucksSaved=sum(l["trucksBefore"] - l["trucksAfter"] for l in loops),
                  kmSaved=round(sum(l["kmBefore"] - l["kmAfter"] for l in loops), 1),
                  co2eSavedKg=round(sum(l["co2eBeforeKg"] - l["co2eAfterKg"] for l in loops), 1),
                  suppliersInLoops=sum(len(l["members"]) for l in loops),
                  excluded=sorted(excluded, key=lambda e: e["supplierId"]))
    return dict(loops=loops, totals=totals)
