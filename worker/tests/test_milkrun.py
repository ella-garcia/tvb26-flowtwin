"""Load-consolidation planner: capacity, resilience guard, exclusions, savings, determinism."""
import copy
import math

from engine.circular import DEFAULT_FACTOR
from engine.milkrun import bearing, plan_consolidation

PLANT = dict(id="qss", lat=20.59, lon=-100.39)
SETTINGS = dict(pallets_per_truck=24, milkrun_radius_km=120)


def sup(sid, lat, lon):
    return dict(id=sid, lat=lat, lon=lon)


def fp(road_km, trucks, pallets, cap=24):
    km = trucks * road_km * 2
    return dict(roadKm=road_km, trucksPerWeek=trucks, palletsPerWeek=pallets, fillRate=round(pallets / (trucks * cap), 3),
                truckKmPerWeek=km, co2ePerWeekKg=round(km * 1.05, 1))


# three suppliers west of the plant, close together (León, Silao, Celaya side) and one far to the south-east
SUPPLIERS = {"a": sup("a", 21.12, -101.68), "b": sup("b", 20.94, -101.43), "c": sup("c", 21.30, -101.90), "far": sup("far", 18.85, -97.10)}
FOOT = {"a": fp(208, 1, 10), "b": fp(150, 1, 6), "c": fp(240, 1, 8), "far": fp(500, 1, 9)}
RISKS = {s: dict(level="green", days_to_line_stop=None) for s in SUPPLIERS}


def plan(footprints=FOOT, risks=RISKS, suppliers=SUPPLIERS, settings=SETTINGS):
    return plan_consolidation(PLANT, suppliers, footprints, risks, settings, DEFAULT_FACTOR)


def test_nearby_suppliers_in_the_same_direction_share_a_loop():
    p = plan()
    assert len(p["loops"]) == 1
    l = p["loops"][0]
    assert l["id"] == "loop-1" and sorted(l["members"]) == ["a", "b", "c"] and "far" not in l["members"]
    assert l["trucksBefore"] == 3 and l["trucksAfter"] == 1 and l["deliveriesPerWeek"] == 1
    assert p["totals"]["trucksSaved"] == 2 and p["totals"]["suppliersInLoops"] == 3


def test_capacity_is_respected():
    big = dict(FOOT, a=fp(208, 1, 14), b=fp(150, 1, 12), c=fp(240, 1, 10))     # 36 pallets: not one truck a week
    for l in plan(big)["loops"]:
        pallets = sum(big[m]["palletsPerWeek"] for m in l["members"])
        assert pallets <= l["trucksAfter"] * 24 + 1e-9
        assert l["fillAfter"] <= 1.0


def test_frequency_is_never_lowered():
    freq = dict(FOOT, a=fp(208, 3, 30), b=fp(150, 1, 6), c=fp(240, 1, 8))
    for l in plan(freq)["loops"]:
        assert l["deliveriesPerWeek"] == max(freq[m]["trucksPerWeek"] for m in l["members"])
        assert l["deliveriesPerWeek"] >= max(freq[m]["trucksPerWeek"] for m in l["members"])
        assert l["trucksAfter"] >= l["deliveriesPerWeek"]


def test_red_and_line_stop_suppliers_are_excluded_with_a_reason():
    risks = dict(RISKS, a=dict(level="red", days_to_line_stop=2), b=dict(level="amber", days_to_line_stop=5))
    p = plan(risks=risks)
    assert {"supplierId": "a", "reason": "At risk now: red light"} in p["totals"]["excluded"]
    assert {"supplierId": "b", "reason": "Line stop expected in 5 days"} in p["totals"]["excluded"]
    assert all(m not in ("a", "b") for l in p["loops"] for m in l["members"])


def test_full_trucks_and_far_suppliers_stay_out():
    full = dict(FOOT, a=fp(208, 1, 20))                      # fill 0.83: not a candidate
    assert all("a" not in l["members"] for l in plan(full)["loops"])
    assert all("far" not in l["members"] for l in plan()["loops"])
    # a supplier in the opposite direction is never merged, even if it is within the radius of another
    opp = dict(SUPPLIERS, d=sup("d", 20.30, -99.80))
    opp_fp = dict(FOOT, d=fp(75, 1, 5))
    assert all("d" not in l["members"] for l in plan(opp_fp, dict(RISKS, d=RISKS["a"]), opp)["loops"])


def test_kept_loops_never_add_km_or_co2e():
    p = plan()
    for l in p["loops"]:
        assert l["kmAfter"] < l["kmBefore"] and l["co2eAfterKg"] < l["co2eBeforeKg"]
        assert math.isclose(l["co2eAfterKg"], l["kmAfter"] * 1.05, abs_tol=0.2)
        assert l["provenance"] == "estimated"
    t = p["totals"]
    assert t["kmSaved"] >= 0 and t["co2eSavedKg"] >= 0 and t["trucksSaved"] >= 0
    assert math.isclose(t["kmSaved"], sum(l["kmBefore"] - l["kmAfter"] for l in p["loops"]), abs_tol=0.2)


def test_a_loop_that_would_cost_more_is_dropped():
    # frequency 6 for one member forces 6 round trips of the long loop: more km than separate trucks
    heavy = dict(FOOT, a=fp(208, 1, 10), b=fp(150, 6, 100), c=fp(240, 1, 8))
    for l in plan(heavy)["loops"]:
        assert l["kmAfter"] < l["kmBefore"]


def test_deterministic():
    a, b = plan(), plan(copy.deepcopy(FOOT), copy.deepcopy(RISKS), copy.deepcopy(SUPPLIERS))
    assert a == b
    reordered = {k: FOOT[k] for k in reversed(list(FOOT))}
    assert plan(reordered) == a


def test_bearing_points_the_right_way():
    assert round(bearing(20.0, -100.0, 21.0, -100.0)) == 0
    assert round(bearing(20.0, -100.0, 20.0, -99.0)) == 90


def test_qss_seed_plan_has_a_loop_with_savings(seed):
    plans = {p["customerId"]: p for p in seed["consolidationPlans"]}
    qss = plans["qss"]
    assert qss["loops"] and qss["totals"]["kmSaved"] > 0
    assert any(x["supplierId"] == "hmo" for x in qss["totals"]["excluded"])
