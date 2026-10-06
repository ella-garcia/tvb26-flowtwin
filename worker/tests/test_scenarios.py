"""What-if scenarios: precomputed action combinations on top of the 12-week outlook."""
from datetime import date

from engine.outlook import outlook
from engine.scenarios import recommended, scenarios

AS_OF = date(2026, 10, 5)
SUP = dict(id="x", city="Orizaba", lat=18.85, lon=-97.10, highways=["MEX-150D"])
PARTS = [dict(days_of_cover=3.0, criticality="line-stopper", single_source=True)]
RAIN = dict(id="s", kind="weather", short="Rain", title="Rain", lat=18.85, lon=-97.10, radius_km=50, highways=[],
            starts_at="2026-10-05", ends_at="2026-10-25", transit_multiplier=2.6)


def test_no_action_combination_equals_the_outlook():
    sc = scenarios(SUP, PARTS, [RAIN], AS_OF, 2)
    base = sc["combos"]["0" * len(sc["actions"])]
    assert [w["level"] for w in base] == [w["level"] for w in outlook(SUP, PARTS, [RAIN], AS_OF, 2)]
    assert len(sc["combos"]) == 2 ** len(sc["actions"]) <= 8


def test_actions_are_picked_from_the_signals_and_parts():
    assert recommended(SUP, PARTS, [RAIN], AS_OF) == ["alt_route", "safety_stock", "second_source"]
    assert recommended(SUP, [dict(days_of_cover=3.0, criticality="normal")], [], AS_OF) == ["safety_stock", "pull_forward"]


def test_rerouting_lowers_the_level_while_the_rain_lasts():
    sc = scenarios(SUP, PARTS, [RAIN], AS_OF, 2)
    base, routed = sc["combos"]["000"], sc["combos"]["100"]
    assert base[0]["level"] == "red" and base[0]["extraDays"] == 3.2
    assert routed[0]["extraDays"] == 1.3 and routed[0]["level"] == "amber"     # 60% of the storm delay avoided


def test_second_source_only_counts_from_week_ten():
    late = dict(RAIN, starts_at="2026-12-07", ends_at="2026-12-27")
    sc = scenarios(SUP, PARTS, [late], AS_OF, 2)
    base, dual = sc["combos"]["000"], sc["combos"]["001"]
    assert base[9]["level"] == "red" and dual[9]["level"] == "red"             # week 10 (index 9): not ready yet
    assert base[10]["level"] == "red" and dual[10]["level"] == "green"         # from week 11 on: covered
