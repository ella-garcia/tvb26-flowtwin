"""What-if scenarios: recommended actions per supplier and their effect on the 12-week outlook.

Each supplier gets up to MAX_ACTIONS recommended actions, picked from the signals that reach it in the next 12 weeks and
from its parts. Every combination of those actions (2^n, at most 8) is computed with the outlook rule, so the app only
combines precomputed results: one engine, and the "no action" combination equals the outlook exactly.

Action effects (deliberately simple and stated in the app):
  kinds/keep : signals of these kinds keep only `keep` of their extra transit (m -> 1 + (m - 1) * keep)
  cover      : more days of cover on critical parts (in `weeks` only, if given)
  from_week  : the action only counts from that week (e.g. second-source qualification)
  clears     : from then on a delay at this supplier no longer threatens the line (level OK)
Each week also carries shortDays: the days the delay outruns the cover (0-7), i.e. days the line would be down.
"""
from itertools import product

from .outlook import WEEKS, critical_cover, level_for, week_days, week_delay
from .projection import active_on, hit_legs

MAX_ACTIONS = 3
CATALOG = {
    "customs_priority": dict(label="Priority customs release", kinds={"customs", "port"}, keep=0.5,
                             detail="The customs broker files the pedimento early and asks for priority release: customs and port delays are halved."),
    "alt_route": dict(label="Use an alternative route", kinds={"road", "blockade", "weather"}, keep=0.4,
                      detail="Trucks reroute around closures, blockades and storm-hit stretches: 60% of that delay is avoided."),
    "daytime": dict(label="Move departures to daytime", kinds={"theft"}, keep=0.0,
                    detail="Loads leave between 06:00 and 18:00, so night-theft escorts and holds are not needed."),
    "ship_plan": dict(label="Agree a daily ship plan", kinds={"supplier"}, keep=0.5,
                      detail="A confirmed daily ship plan halves the delay caused by the supplier's own problem."),
    "safety_stock": dict(label="Add 2 days of safety stock", cover=2.0,
                         detail="You hold 2 more days of this supplier's critical parts."),
    "second_source": dict(label="Qualify a second source", from_week=10, clears=True,
                          detail="A second source for single-source critical parts is ready after about 10 weeks of qualification (PPAP); from then on a delay here no longer threatens the line."),
    "pull_forward": dict(label="Pull the next orders forward", cover=1.5, weeks=(0, 1),
                         detail="The next two weeks' orders ship early: 1.5 more days of cover in weeks 1 and 2."),
}
SIGNAL_ORDER = ("customs_priority", "alt_route", "daytime", "ship_plan")


def recommended(supplier, parts, signals, as_of):
    """Action ids for this supplier, most relevant first, at most MAX_ACTIONS."""
    horizon = [d for w in range(WEEKS) for d in week_days(as_of, w)]
    kinds = {s["kind"] for s in signals if hit_legs(supplier, s) and any(active_on(s, d) for d in horizon)}
    ids = [a for a in SIGNAL_ORDER if CATALOG[a]["kinds"] & kinds]
    ids.append("safety_stock")
    if any(p.get("single_source") and p["criticality"] in ("line-stopper", "high") for p in parts):
        ids.append("second_source")
    ids.append("pull_forward")
    return ids[:MAX_ACTIONS]


def _scaled(signals, kinds_keep):
    out = []
    for s in signals:
        keep = kinds_keep.get(s["kind"])
        out.append(s if keep is None else {**s, "transit_multiplier": 1 + (float(s["transit_multiplier"]) - 1) * keep})
    return out


def weeks_with(supplier, parts, signals, as_of, normal, action_ids):
    """Outlook levels for 12 weeks with these actions in place."""
    acts = [CATALOG[a] for a in action_ids]
    kinds_keep = {}
    for a in acts:
        for k in a.get("kinds", ()):
            kinds_keep[k] = min(kinds_keep.get(k, 1.0), a["keep"])
    sigs = _scaled(signals, kinds_keep) if kinds_keep else signals
    base_cover = critical_cover(parts)
    out = []
    for w in range(WEEKS):
        live = [a for a in acts if w >= a.get("from_week", 0) and (not a.get("weeks") or w in a["weeks"])]
        cover = base_cover + sum(a.get("cover", 0) for a in live)
        delay = 0.0 if any(a.get("clears") for a in live) else week_delay(supplier, sigs, week_days(as_of, w), normal)
        out.append(dict(level=level_for(delay, cover), extraDays=round(delay, 1), shortDays=round(min(7.0, max(0.0, delay - cover)), 1)))
    return out


def scenarios(supplier, parts, signals, as_of, normal):
    ids = recommended(supplier, parts, signals, as_of)
    combos = {}
    for bits in product("01", repeat=len(ids)):
        key = "".join(bits)
        combos[key] = weeks_with(supplier, parts, signals, as_of, normal, [a for a, b in zip(ids, bits) if b == "1"])
    return dict(actions=[dict(id=a, label=CATALOG[a]["label"], detail=CATALOG[a]["detail"]) for a in ids], combos=combos)
