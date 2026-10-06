"""Route legs: imported material crosses a border, where customs is a control point (professor feedback D)."""
from datetime import date

from engine.projection import hit_legs, leg_hit, project

LEG = dict(kind="customs", label="Customs", place="Nuevo Laredo", lat=27.48, lon=-99.51, days=1.0, highways=[])
ROAD = dict(kind="road", label="Road", place="MEX-57D", lat=25.67, lon=-100.31, days=2.0, highways=["MEX-57D"])
CUSTOMS = dict(id="c", kind="customs", lat=27.50, lon=-99.52, radius_km=25, highways=[], starts_at="2026-10-01",
               ends_at="2026-10-30", transit_multiplier=3.0)
ROADSIG = dict(id="r", kind="road", lat=20.6, lon=-100.0, radius_km=10, highways=["MEX-57D"], starts_at="2026-10-01",
               ends_at="2026-10-30", transit_multiplier=1.5)
CUST = dict(id="qss", name="QSS", lat=20.59, lon=-100.39)
SETTINGS = dict(line_stop_cost_eur_per_minute=15000, line_hours_per_day=16)


def supplier(**k):
    return dict(id="x", city="Laredo", lat=27.53, lon=-99.49, highways=[], lead_time_variability=0.1, **k)


def test_signal_kind_decides_which_legs_slow_down():
    assert leg_hit(LEG, CUSTOMS) and not leg_hit(ROAD, CUSTOMS)      # customs outage: customs leg only
    assert leg_hit(ROAD, ROADSIG) and not leg_hit(LEG, ROADSIG)      # road closure: road leg only (by highway)
    assert hit_legs(supplier(route=[LEG, ROAD]), CUSTOMS) == [LEG]
    assert hit_legs(supplier(), ROADSIG) == []                        # no route: single-leg rule (not on MEX-57D, far away)


def test_route_transit_is_the_sum_of_legs_with_signals_on_their_legs():
    part = dict(id="p", number="P", name="Pellets", days_of_cover=5.0, criticality="high", single_source=True)
    calm = project(CUST, supplier(route=[LEG, ROAD]), [part], [], SETTINGS, date(2026, 10, 5))
    assert calm["normal"] == 3 and [l["expectedDays"] for l in calm["legs"]] == [1.0, 2.0]
    hit = project(CUST, supplier(route=[LEG, ROAD]), [part], [CUSTOMS], SETTINGS, date(2026, 10, 5))
    assert [l["expectedDays"] for l in hit["legs"]] == [3.0, 2.0]    # customs x3, road unchanged
    assert hit["expected"] > calm["expected"] + 1.5
