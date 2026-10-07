"""WP2 engine paths with hand-built inputs: pipeline stock, input shortage, capacity events, trade exposure, bands."""
import json
from datetime import date, timedelta

import pytest

from engine import DEFAULT_SETTINGS
from engine.flex import run_flex
from engine.outlook import outlook
from engine.projection import (BAND_WIDEN_FROM_DAY, HORIZON, SIGNAL_LEGS, band_widen, hit_legs, leg_hit, multiplier_on,
                               project)
from engine.risk import compute_pair
from engine.trade import TRADE_MAX_PTS, part_matches, trade_drivers

AS_OF = date(2026, 10, 5)
CUST = dict(id="c", name="Cust", lat=20.59, lon=-100.39)


def sup(**kw):
    base = dict(id="s", name="Sup", city="Celaya", lat=20.52, lon=-100.81, highways=["MEX-45D"], lead_time_variability=0.1,
                utilization=0.7, ceiling=0.95, fg_days=1.0, bottleneck="Line 1", otif=[0.98, 0.98, "flat"], data_status="connected")
    return {**base, **kw}


def part(c0, **kw):
    base = dict(id="p1", number="P-1", name="Bracket", days_of_cover=c0, criticality="line-stopper", single_source=True,
                daily_usage=100)
    return {**base, **kw}


def sig(kind, mult=1.0, start=AS_OF, days=30, **kw):
    base = dict(id=f"sig-{kind}", kind=kind, title=f"{kind} event", short=f"{kind} event", lat=20.52, lon=-100.81, radius_km=50,
                highways=["MEX-45D"], starts_at=start.isoformat(), ends_at=(start + timedelta(days=days)).isoformat(),
                severity="high", transit_multiplier=mult)
    return {**base, **kw}


def d(n):
    return (AS_OF + timedelta(days=n)).isoformat()


def proj(parts, signals, supplier=None):
    return project(CUST, supplier or sup(), parts, signals, DEFAULT_SETTINGS, AS_OF)


def transit(p):
    return [(x["transitP10"], x["transitP50"], x["transitP90"]) for x in p["projection"]], p["normal"], p["expected"], p["worst"], p["legs"]


# ---------------------------------------------------------------- 1. pipeline stock
ROAD = sig("road", 3.0)  # transit 1 -> 3 days: median gap 2 days


def test_without_pipeline_the_line_stops_on_day_1():
    assert proj([part(1.5)], [ROAD])["days_to_line_stop"] == 1


def test_pipeline_arriving_before_the_stop_day_prevents_it():
    p = proj([part(1.5, in_transit=100, next_delivery_date=d(1))], [ROAD])
    assert p["days_to_line_stop"] is None
    assert p["projection"][0]["coverDays"] == 0.5 and p["projection"][1]["coverDays"] == 0.5


def test_pipeline_arriving_after_the_stop_day_does_not_help():
    p = proj([part(1.5, in_transit=100, next_delivery_date=d(3))], [ROAD])
    assert p["days_to_line_stop"] == 1
    assert p["projection"][3]["coverDays"] == 0.5  # the truck lands on day 3, after the stop


def test_unknown_pipeline_keeps_todays_behaviour():
    base = proj([part(1.5)], [ROAD])
    for extra in (dict(in_transit=100), dict(next_delivery_date=d(1)), dict(in_transit=None, next_delivery_date=d(1))):
        p = proj([part(1.5, **extra)], [ROAD])
        assert p["projection"] == base["projection"] and p["days_to_line_stop"] == base["days_to_line_stop"]
        assert p["exposure"] == base["exposure"]


# ---------------------------------------------------------------- 2. supplier input shortage
CUT = sig("supplier-input", 1.0, supply_cut_pct=0.5, affects={"supplierIds": ["s"]}, highways=[], radius_km=5)


def test_input_cut_is_buffered_by_the_parts_finished_goods():
    # 0.5 day of deliveries lost per day, 1 day of finished goods: cover = 3 - (0.5 (i + 1) - 1), stop when <= 0.05
    p = proj([part(3.0, supplier_fg_on_hand=100)], [CUT], sup(fg_days=3.0))
    assert p["days_to_line_stop"] == 7 and p["stop_cause"] == "input"
    assert [x["coverDays"] for x in p["projection"][:3]] == [3.0, 3.0, 2.5]


def test_input_cut_falls_back_to_profile_finished_goods_days():
    p = proj([part(3.0)], [CUT], sup(fg_days=3.0))  # 3 days of finished goods: stop when 0.5 (i + 1) - 3 >= 2.95
    assert p["days_to_line_stop"] == 11


def test_input_cut_only_reaches_named_suppliers():
    other = {**CUT, "affects": {"supplierIds": ["someone-else"]}}  # same place, but names another supplier
    assert proj([part(3.0)], [other])["days_to_line_stop"] is None
    by_place = {**CUT, "affects": None}  # no supplier named: by place, like other signals
    assert proj([part(3.0)], [by_place], sup(fg_days=1.0))["days_to_line_stop"] == 7


def test_daily_loss_is_the_larger_of_transit_and_input_gap():
    # transit gap 2 days (capped by elapsed days) vs input gap 0.5 (i + 1) - 1: the max of both, never the sum
    p = proj([part(10.0, supplier_fg_on_hand=100)], [ROAD, CUT])
    cover = [x["coverDays"] for x in p["projection"]]
    assert cover[:2] == [9.0, 8.0]  # transit gap leads
    assert cover[9] == 6.0  # day 9: input gap 0.5 x 10 - 1 = 4 > 2


def test_input_shortage_driver_alert_and_flex():
    risk, ctx = compute_pair(CUST, sup(), [part(3.0, supplier_fg_on_hand=100)], [CUT], DEFAULT_SETTINGS, AS_OF)
    drv = [x for x in risk["drivers"] if x["kind"] == "supplier-input"]
    assert drv and drv[0]["label"].startswith("Input shortage at the supplier") and drv[0]["signalId"] == CUT["id"]
    assert sum(x["contribution"] for x in risk["drivers"]) == risk["score"]
    assert risk["flex"]["canAbsorb"] is False  # half the capacity for the whole test
    assert ctx["input"]["signal"]["id"] == CUT["id"]
    from engine.alerts import make_alert
    al = make_alert(CUST, sup(), risk, ctx, AS_OF, {CUT["id"]: CUT})
    assert al["title"] == "Input shortage at Sup: deliveries down 50%"
    assert "€" not in al["message"] and "MX$" not in al["message"] and "MXN" not in al["message"]


# ---------------------------------------------------------------- 3. capacity events (flex only)
def test_capacity_events_change_flex_for_their_dates_only():
    s = sup(utilization=0.88, ceiling=0.95, fg_days=0.5)
    base = run_flex(s, 0.15, AS_OF)
    assert base == run_flex(s, 0.15)  # no events, no cuts: unchanged
    down = run_flex(s, 0.15, AS_OF, events=[dict(starts_on=d(0), ends_on=d(9), capacity_change_pct=-0.3)])
    up = run_flex(s, 0.15, AS_OF, events=[dict(starts_on=d(0), ends_on=None, capacity_change_pct=0.1)])
    later = run_flex(s, 0.15, AS_OF, events=[dict(starts_on=d(40), ends_on=d(50), capacity_change_pct=-0.9)])
    assert down["serviceLevel"] < base["serviceLevel"] < up["serviceLevel"]
    assert later == base


def test_capacity_events_stay_private():
    ev = dict(id=1, supplier_id="s", resource="Prensa 3", starts_on=d(0), ends_on=d(20), capacity_change_pct=-0.4,
              reason="Mantenimiento mayor de la prensa", source="supplier")
    risk, _ = compute_pair(CUST, sup(capacity_events=[ev]), [part(5.0)], [], DEFAULT_SETTINGS, AS_OF)
    plain, _ = compute_pair(CUST, sup(), [part(5.0)], [], DEFAULT_SETTINGS, AS_OF)
    assert risk["flex"] != plain["flex"]
    text = json.dumps(risk, ensure_ascii=False, default=str)
    assert "Prensa 3" not in text and "Mantenimiento" not in text


def test_risk_runner_loads_capacity_events(db_rows):
    import risk_runner
    from tests.test_runner import MemDB
    tables = lambda ev: MemDB(dict(app_settings=[dict(id=1, as_of="2026-10-05", line_stop_cost_eur_per_minute=15000,  # noqa: E731
                                                       contract_demand_swing=0.15, line_hours_per_day=16)],
                                    companies=db_rows["companies"], parts=db_rows["parts"], signals=[], alerts=[], lanes=[],
                                    partners=[], machines=[], invites=[], capacity_events=ev))
    flex = lambda db: next(r for r in db.upserts["risks"] if r["supplier_id"] == "mds")["flex"]  # noqa: E731
    plain, cut = tables([]), tables([dict(supplier_id="mds", starts_on="2026-10-05", ends_on="2026-10-30", capacity_change_pct=-0.5)])
    risk_runner.recompute_customer(plain, "qss")
    risk_runner.recompute_customer(cut, "qss")
    assert flex(plain)["canAbsorb"] is True and flex(cut)["canAbsorb"] is False


# ---------------------------------------------------------------- 4. trade exposure (policy)
CN = part(5.0, origin_country="CN", hs_code="390810")


@pytest.mark.parametrize("affects,hit", [
    ({"originCountries": ["CN"]}, True),
    ({"hsPrefixes": ["3908"]}, True),
    ({"originCountries": ["CN"], "hsPrefixes": ["3908"]}, True),
    ({"originCountries": ["CN"], "hsPrefixes": ["3902"]}, False),  # both listed: both must hold
    ({"originCountries": ["US"]}, False),
    ({"origin_countries": ["CN"]}, True),  # snake_case keys accepted
    ({}, False),  # lists nothing: matches nothing
])
def test_policy_match_by_country_and_hs_prefix(affects, hit):
    assert part_matches(CN, sig("policy", affects=affects)) is hit


def test_parts_without_origin_never_match():
    assert not part_matches(part(5.0), sig("policy", affects={"originCountries": ["CN"]}))
    assert not part_matches(part(5.0, origin_country="CN"), sig("policy", affects={"hsPrefixes": ["3908"]}))


def test_trade_points_are_capped_and_halved_for_non_critical_parts():
    two = [sig("policy", id="a", affects={"originCountries": ["CN"]}), sig("policy", id="b", affects={"hsPrefixes": ["39"]})]
    drv = trade_drivers([CN], two, AS_OF)
    assert len(drv) == 2 and abs(sum(x[2] for x in drv) - TRADE_MAX_PTS) < 1e-9
    normal = {**CN, "criticality": "normal"}
    assert trade_drivers([normal], two[:1], AS_OF)[0][2] == 4
    late = sig("policy", start=AS_OF + timedelta(days=100), affects={"originCountries": ["CN"]})
    assert trade_drivers([CN], [late], AS_OF) == []  # beyond the 12-week horizon


def test_policy_adds_driver_and_outlook_flag_but_no_transit():
    pol = sig("policy", 3.0, start=AS_OF + timedelta(days=20), days=200, affects={"originCountries": ["CN"]})
    risk, _ = compute_pair(CUST, sup(), [CN], [pol], DEFAULT_SETTINGS, AS_OF)
    plain, _ = compute_pair(CUST, sup(), [CN], [], DEFAULT_SETTINGS, AS_OF)
    trade = [x for x in risk["drivers"] if x["kind"] == "policy"]
    assert trade and trade[0]["label"].startswith("Trade exposure") and trade[0]["contribution"] <= TRADE_MAX_PTS
    assert sum(x["contribution"] for x in risk["drivers"]) == risk["score"]
    assert risk["projection"] == plain["projection"] and risk["expected_transit_days"] == plain["expected_transit_days"]
    flags = [w.get("tradeExposure", False) for w in risk["outlook"]]
    assert flags[:2] == [False, False] and all(flags[3:])
    assert [w["level"] for w in risk["outlook"]] == [w["level"] for w in plain["outlook"]]


# ---------------------------------------------------------------- 5. confidence and band widening
def test_confidence_drops_with_distance():
    p = proj([part(5.0)], [])
    assert [x["confidence"] for x in p["projection"]] == ["high"] * 4 + ["medium"] * 4 + ["low"] * (HORIZON - 8)


def test_weather_band_widens_beyond_day_3_only():
    weather, road = proj([part(5.0)], [sig("weather", 1.5)]), proj([part(5.0)], [sig("road", 1.5)])
    for i, (w, r) in enumerate(zip(weather["proj_t"], road["proj_t"])):
        assert w[1] == r[1]  # P50 unchanged
        f = band_widen(i)
        assert (f == 1) == (i <= BAND_WIDEN_FROM_DAY)
        assert w[2] - w[1] == pytest.approx((r[2] - r[1]) * f) and w[1] - w[0] == pytest.approx((r[1] - r[0]) * f)
    assert band_widen(13) == pytest.approx(1.8)


# ---------------------------------------------------------------- 6. supplier-input and policy never change transit
ROUTE = [dict(kind="road", label="Road", place="A", lat=20.52, lon=-100.81, days=1.0, highways=["MEX-45D"]),
         dict(kind="customs", label="Customs", place="B", lat=20.52, lon=-100.81, days=1.0, highways=[])]


@pytest.mark.parametrize("kind", ["supplier-input", "policy"])
def test_input_and_policy_signals_never_slow_transit(kind):
    s = sig(kind, 3.0, supply_cut_pct=0.5, affects={"supplierIds": ["s"], "originCountries": ["CN"]})  # x3 on purpose
    assert kind not in SIGNAL_LEGS
    for supplier in (sup(), sup(route=ROUTE)):
        assert hit_legs(supplier, s) == [] and multiplier_on(supplier, [s], AS_OF) == 1.0
        assert transit(proj([CN], [s], supplier)) == transit(proj([CN], [], supplier))
        delays = lambda sigs: [(w["extraDays"], w["level"]) for w in outlook(supplier, [CN], sigs, AS_OF, 2)]  # noqa: E731
        assert delays([s]) == delays([])
    assert not any(leg_hit(leg, s) for leg in ROUTE)
