"""12-week outlook: weekly levels from signals known in advance."""
from datetime import date

from engine.outlook import WEEKS, outlook

SUP = dict(id="x", city="Orizaba", lat=18.85, lon=-97.10, highways=["MEX-150D"])
PART = dict(days_of_cover=3.0, criticality="line-stopper")


def sig(mult, start, end):
    return dict(id="s", kind="weather", short="Storms", title="Storms", lat=18.85, lon=-97.10, radius_km=50, highways=[],
                starts_at=start, ends_at=end, transit_multiplier=mult)


def test_twelve_weeks_green_without_signals():
    weeks = outlook(SUP, [PART], [], date(2026, 10, 5), 2)
    assert len(weeks) == WEEKS and {w["level"] for w in weeks} == {"green"} and weeks[0]["weekStart"] == "2026-10-05"
    assert weeks[11]["weekStart"] == "2026-12-21"


def test_level_compares_the_week_delay_with_critical_cover():
    weeks = outlook(SUP, [PART], [sig(2.6, "2026-10-12", "2026-10-18"), sig(1.6, "2026-11-02", "2026-11-08")], date(2026, 10, 5), 2)
    assert weeks[0]["level"] == "green"
    assert weeks[1]["level"] == "red" and weeks[1]["extraDays"] == 3.2 and weeks[1]["signals"] == ["Storms"]   # 3.2 >= 3 days cover
    assert weeks[4]["level"] == "amber" and weeks[4]["extraDays"] == 1.2                                         # >= 1 day
