"""+15% demand surge test (28 days): bottleneck load vs practical ceiling plus finished-goods stock.

Capacity on day d of the test (d = 0 is as_of) = ceiling x noise x (1 - input cut on d) x prod(1 + capacity_change_pct)
over the supplier's capacity events covering d (-0.3 = 30% less, +0.1 = 10% more), floored at 0. Input cuts come from
active `supplier-input` signals (projection.input_cut_on). Capacity events are private to the supplier: only this result
is exposed. Without as_of, cuts and events the test is unchanged.
"""
import math
import random
from datetime import timedelta

from .geo import hash_seed
from .projection import _d

FLEX_DAYS = 28
FLEX_RUNS = 300
SERVICE_TARGET = 0.985


def capacity_factors(as_of=None, cuts=None, events=()):
    """Capacity factor per day of the test. cuts: per-day input cut from as_of (may be shorter); events: capacity_events rows."""
    out = []
    for i in range(FLEX_DAYS):
        f = 1 - (cuts[i] if cuts and i < len(cuts) else 0.0)
        if as_of is not None:
            d = as_of + timedelta(days=i)
            for e in events or ():
                end = _d(e["ends_on"]) if e.get("ends_on") else None
                if _d(e["starts_on"]) <= d and (end is None or d <= end):
                    f *= 1 + float(e["capacity_change_pct"])
        out.append(max(0.0, f))
    return out


def run_flex(supplier, swing, as_of=None, cuts=None, events=()):
    """supplier needs: id, utilization, ceiling, fg_days, bottleneck, data_status."""
    u, ceil_, fg = supplier["utilization"], supplier["ceiling"], supplier["fg_days"]
    factor = capacity_factors(as_of, cuts, events)
    rng = random.Random(hash_seed(supplier["id"], "flex"))
    sl, recov = [], []
    for _ in range(FLEX_RUNS):
        stock, fg0, backlog, unmet_tot, dem_tot = fg * u, fg * u, 0.0, 0.0, 0.0
        for d in range(FLEX_DAYS):
            demand = u * (1 + swing) * (1 + rng.gauss(0, 0.04))
            cap = ceil_ * (1 + rng.gauss(0, 0.03)) * factor[d]
            avail = cap + stock
            ship = min(demand, avail)
            unmet = demand - ship
            stock = min(fg0, avail - ship)
            backlog += unmet
            unmet_tot += unmet
            dem_tot += demand
        spare = max(0.005, ceil_ - u)
        sl.append(1 - unmet_tot / dem_tot)
        recov.append(backlog / spare)
    service = sum(sl) / len(sl)
    days = sum(recov) / len(recov)
    can = service >= SERVICE_TARGET
    return dict(demandIncrease=swing, canAbsorb=can, serviceLevel=round(service, 3),
                daysToRecover=0 if can and days < 0.5 else int(math.ceil(days)),
                headroom=round(1 - u, 2), bottleneck=supplier["bottleneck"],
                provenance="measured" if supplier["data_status"] == "connected" else "estimated")
