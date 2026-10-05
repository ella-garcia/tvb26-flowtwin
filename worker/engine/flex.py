"""+15% demand surge test (28 days): bottleneck load vs practical ceiling plus finished-goods stock."""
import math
import random

from .geo import hash_seed

FLEX_DAYS = 28
FLEX_RUNS = 300
SERVICE_TARGET = 0.985


def run_flex(supplier, swing):
    """supplier needs: id, utilization, ceiling, fg_days, bottleneck, data_status."""
    u, ceil_, fg = supplier["utilization"], supplier["ceiling"], supplier["fg_days"]
    rng = random.Random(hash_seed(supplier["id"], "flex"))
    sl, recov = [], []
    for _ in range(FLEX_RUNS):
        stock, fg0, backlog, unmet_tot, dem_tot = fg * u, fg * u, 0.0, 0.0, 0.0
        for _d in range(FLEX_DAYS):
            demand = u * (1 + swing) * (1 + rng.gauss(0, 0.04))
            cap = ceil_ * (1 + rng.gauss(0, 0.03))
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
