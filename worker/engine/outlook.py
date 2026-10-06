"""12-week outlook: weekly risk from signals known in advance (seasonal patterns, announced events).

Coarser than the 14-day projection and always estimated: no Monte Carlo, and it cannot see events nobody has announced.
Per week: the largest expected delay vs normal transit (signal multipliers only, route legs weighted like the projection),
compared with the lowest days of cover of the supplier's critical parts, taken as the standing buffer.
  red   : the delay would use up that cover
  amber : the delay uses half of it, or is a day or more
  green : otherwise
"""
from datetime import timedelta

from .projection import active_on, hit_legs, leg_multiplier_on, multiplier_on

WEEKS = 12


def critical_cover(parts):
    """Lowest days of cover among line-stopper and high parts (all parts if there are none): the standing buffer."""
    crit = [float(p["days_of_cover"]) for p in parts if p["criticality"] in ("line-stopper", "high")]
    return min(crit or [float(p["days_of_cover"]) for p in parts])


def week_days(as_of, w):
    return [as_of + timedelta(days=7 * w + i) for i in range(7)]


def week_delay(supplier, signals, days, normal):
    """Largest expected delay vs normal transit over these days, from signal multipliers (route legs weighted)."""
    route = supplier.get("route")
    if route:
        M = [sum(float(leg["days"]) * leg_multiplier_on(leg, signals, d) for leg in route) / normal for d in days]
    else:
        M = [multiplier_on(supplier, signals, d) for d in days]
    return max(normal * (m - 1) for m in M)


def level_for(delay, cover):
    return "red" if delay >= cover else "amber" if (delay >= 0.5 * cover or delay >= 1) else "green"


def outlook(supplier, parts, signals, as_of, normal):
    cover = critical_cover(parts)
    weeks = []
    for w in range(WEEKS):
        days = week_days(as_of, w)
        delay = week_delay(supplier, signals, days, normal)
        sigs = [s for s in signals if hit_legs(supplier, s) and any(active_on(s, d) for d in days)]
        weeks.append(dict(weekStart=days[0].isoformat(), expectedTransitDays=round(normal + delay, 1), extraDays=round(delay, 1),
                          level=level_for(delay, cover), signals=[s.get("short_label") or s.get("short") or s["title"] for s in sigs]))
    return weeks
