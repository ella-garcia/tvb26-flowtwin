"""Risk score (0-100) as a sum of integer driver points, and the traffic light."""
import math

from .geo import clamp
from .projection import CRIT_W, active_on, affects


def score_drivers(customer, supplier, proj, flex, otif, signals):
    """Return (score, drivers). drivers are {label, kind, [signalId], contribution} with integer contributions summing to score."""
    normal, days, proj_t, exposed = proj["normal"], proj["days"], proj["proj_t"], proj["exposed"]
    ex_part, c0 = exposed["part"], exposed["c0"]
    drivers = []  # (label, kind, signal_id, points)
    gap90 = max(0.0, max(t[2] for t in proj_t) - normal)
    delay_pts = 45 * clamp(gap90 / max(c0, 0.5) / 2.0)
    sigs = [s for s in signals if affects(supplier, s) and any(active_on(s, d) for d in days)]
    if sigs and delay_pts > 0.5:
        w = {s["id"]: math.log(float(s["transit_multiplier"])) for s in sigs}
        tw = sum(w.values())
        for s in sigs:
            extra = normal * (float(s["transit_multiplier"]) - 1)
            short = s.get("short_label") or s.get("short") or s["title"]  # DB column; `short` in the v0 seed
            if s["kind"] == "supplier":
                lab = f"{short} delays outbound loads by about {extra:.1f} days"
            elif s["kind"] == "theft":
                lab = f"{short} adds about {extra:.1f} days (escorts, daytime-only departures)"
            else:
                lab = f"{short} adds {extra:.1f} days to transit from {supplier['city']}"
            drivers.append((lab, s["kind"], s["id"], delay_pts * w[s["id"]] / tw))
    elif delay_pts > 0.5:
        drivers.append((f"Normal transit variability against {c0:g} days of cover", "cover", None, delay_pts))
    crit, single = ex_part["criticality"], bool(ex_part["single_source"])
    crit_pts = {"line-stopper": 10, "high": 5, "normal": 1}[crit] + (6 if single else 0)
    lab = f"{ex_part['name']} is a {'single-source ' if single else ''}{crit.replace('-', ' ')} part"
    drivers.append((lab, "cover", None, crit_pts))
    if crit in ("line-stopper", "high"):
        thin = 8 * clamp((5 - c0) / 4)
        if thin > 0.5:
            drivers.append((f"Only {c0:g} days of cover at {customer['name']}", "cover", None, thin))
    if not flex["canAbsorb"]:
        fp = 14 * clamp((0.99 - flex["serviceLevel"]) / 0.08)
        drivers.append((f"Cannot absorb +15% demand: service level {flex['serviceLevel']*100:.0f}% at {flex['bottleneck']}", "flex", None, max(fp, 3)))
    decline = sum(otif[:4]) / 4 - sum(otif[-4:]) / 4
    op = 10 * clamp(decline / 0.06)
    if op > 0.5:
        drivers.append((f"On-time-in-full fell {decline*100:.1f} points over 12 weeks", "history", None, op))
    cv = supplier["lead_time_variability"]
    vp = 8 * clamp(cv / 0.4)
    if vp > 0.5:
        drivers.append((f"Lead-time variability of {cv*100:.0f}%", "history", None, vp))
    if supplier["data_status"] == "invited":
        drivers.append(("No data from the supplier yet (invited); score uses public signals only", "history", None, 8))
    if supplier["data_status"] == "public-only":
        drivers.append(("Supplier not on FlowTwin; score uses public signals only", "history", None, 6))

    total = sum(d[3] for d in drivers)
    scale = 100 / total if total > 100 else 1
    pts = [d[3] * scale for d in drivers]
    score = int(round(sum(pts)))
    fl = [int(math.floor(p)) for p in pts]
    rem = score - sum(fl)
    for i in sorted(range(len(pts)), key=lambda i: pts[i] - fl[i], reverse=True)[:max(0, rem)]:
        fl[i] += 1
    out = [dict(label=d[0], kind=d[1], **({"signalId": d[2]} if d[2] else {}), contribution=c) for d, c in zip(drivers, fl) if c > 0]
    out.sort(key=lambda x: -x["contribution"])
    return score, out


def traffic_light(score, days_to_line_stop):
    """red if score >= 65 or a stop within 3 days; amber if >= 35; else green."""
    if score >= 65 or (days_to_line_stop is not None and days_to_line_stop <= 3):
        return "red"
    return "amber" if score >= 35 else "green"
