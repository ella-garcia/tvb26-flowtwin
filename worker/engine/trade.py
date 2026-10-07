"""Trade exposure: `policy` signals (tariff, USMCA or customs-rule events) that reach a part by origin country or tariff code.

A policy signal matches a part when every criterion it lists holds: the part's `origin_country` is in
affects.originCountries (if listed) and its `hs_code` starts with one of affects.hsPrefixes (if listed). A signal that lists
neither matches nothing. Parts without origin or code never match (unknown stays unknown).
Policy signals never change transit; they add the driver "Trade exposure" (scoring.py) and flag outlook weeks (outlook.py).

Points (hand-set, estimated): per matching signal TRADE_SEVERITY_PTS[severity], halved when no matched part is a
line-stopper or high-criticality part; the sum is capped at TRADE_MAX_PTS.
"""
from datetime import timedelta

from .projection import _d, affects_list

TRADE_MAX_PTS = 8
TRADE_SEVERITY_PTS = {"high": 8, "medium": 5, "low": 3}


def part_matches(part, sig):
    if sig["kind"] != "policy":
        return False
    countries = [c.upper() for c in affects_list(sig, "originCountries")]
    prefixes = [str(h) for h in affects_list(sig, "hsPrefixes")]
    if not countries and not prefixes:
        return False
    origin, hs = (part.get("origin_country") or "").upper(), str(part.get("hs_code") or "")
    if countries and origin not in countries:
        return False
    if prefixes and not (hs and any(hs.startswith(p) for p in prefixes)):
        return False
    return True


def overlaps(sig, start, end):
    return _d(sig["starts_at"]) <= end and _d(sig["ends_at"]) >= start


def exposures(parts, signals, start, end):
    """[(signal, matched parts)] for policy signals active at some point between start and end that match a part."""
    out = []
    for s in signals:
        if s["kind"] == "policy" and overlaps(s, start, end):
            hit = [p for p in parts if part_matches(p, s)]
            if hit:
                out.append((s, hit))
    return out


def signal_points(sig, hit):
    base = TRADE_SEVERITY_PTS.get(sig.get("severity"), TRADE_SEVERITY_PTS["medium"])
    return base if any(p["criticality"] in ("line-stopper", "high") for p in hit) else base / 2


def fdate(d):
    return f"{d.day} {d.strftime('%b %Y')}"


def trade_drivers(parts, signals, as_of, weeks=12):
    """[(label, signal_id, points)] over the outlook horizon; points sum to at most TRADE_MAX_PTS. No money in the text."""
    end = as_of + timedelta(days=7 * weeks - 1)
    ex = exposures(parts, signals, as_of, end)
    if not ex:
        return []
    raw = [signal_points(s, hit) for s, hit in ex]
    scale = min(1.0, TRADE_MAX_PTS / sum(raw))
    out = []
    for (s, hit), pts in zip(ex, raw):
        short = s.get("short_label") or s.get("short") or s["title"]
        nums = ", ".join(p["number"] for p in hit)
        origins = sorted({(p.get("origin_country") or "").upper() for p in hit} - {""})
        start = _d(s["starts_at"])
        when = f" from {fdate(start)}" if start > as_of else ""
        lab = f"Trade exposure: {short} applies to {nums}{' (origin ' + ', '.join(origins) + ')' if origins else ''}{when}"
        out.append((lab, s["id"], pts * scale))
    return out
