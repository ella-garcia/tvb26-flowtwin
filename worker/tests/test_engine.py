"""The engine, fed with the seed.json inputs, must reproduce the seed's risks and alerts (no DB needed)."""
from datetime import date

import pytest

from engine import compute_customer
from engine.profiles import build_supplier, derive_from_operating_data, static_profiles

AS_OF = date(2026, 10, 5)


def run(db_rows, customer_id):
    comps = {c["id"]: c for c in db_rows["companies"]}
    parts = [p for p in db_rows["parts"] if p["customer_id"] == customer_id]
    suppliers = {sid: build_supplier(comps[sid]) for sid in {p["supplier_id"] for p in parts}}
    return compute_customer(comps[customer_id], suppliers, parts, db_rows["signals"], db_rows["settings"], AS_OF)


@pytest.fixture(scope="module")
def qss(db_rows):
    risks, alerts = run(db_rows, "qss")
    return {r["supplier_id"]: r for r in risks}, alerts


def test_orizaba_stays_red_with_two_days_to_line_stop(qss):
    r = qss[0]["hmo"]
    assert r["level"] == "red"
    assert r["days_to_line_stop"] == 2
    assert r["normal_transit_days"] == 2 and 4.5 <= r["expected_transit_days"] <= 6
    assert r["flex"]["canAbsorb"] is False


def test_edl_stays_amber(qss):
    r = qss[0]["edl"]
    assert r["level"] == "amber"
    assert r["days_to_line_stop"] is None


def test_all_risks_match_seed_exactly(db_rows, seed):
    camel = {"customer_id": "customerId", "supplier_id": "supplierId", "normal_transit_days": "normalTransitDays",
             "expected_transit_days": "expectedTransitDays", "worst_case_transit_days": "worstCaseTransitDays",
             "min_cover_days": "minCoverDays", "days_to_line_stop": "daysToLineStop", "line_stop_exposure_eur": "lineStopExposureEur",
             "otif_trend": "otifTrend", "data_status": "dataStatus", "updated_at": "updatedAt"}
    expected = {(r["customerId"], r["supplierId"]): r for r in seed["risks"]}
    got = {}
    for cid in ("qss", "slp-interiors"):
        for r in run(db_rows, cid)[0]:
            got[(cid, r["supplier_id"])] = {camel.get(k, k): v for k, v in r.items()}
    assert got.keys() == expected.keys()
    for k, exp in expected.items():
        assert got[k] == exp, k


def test_alerts_match_seed_for_scripted_suppliers(db_rows, seed):
    _, alerts = run(db_rows, "qss")
    by_sup = {a["supplier_id"]: a for a in alerts}
    for exp in seed["alerts"]:
        a = by_sup[exp["supplierId"]]
        assert (a["title"], a["message"], a["level"]) == (exp["title"], exp["message"], exp["level"])
        assert a["line_stop_exposure_eur"] == exp["lineStopExposureEur"]
        assert a["part_ids"] == exp["partIds"] and a["signal_id"] == exp.get("signalId")
        assert a["expected_shortfall_date"] == exp.get("expectedShortfallDate")
        assert [x["label"] for x in a["actions"]] == [x["label"] for x in exp["actions"]]
    assert all(a["status"] == "new" for a in alerts)


def test_driver_points_sum_to_score(qss):
    for r in qss[0].values():
        assert sum(d["contribution"] for d in r["drivers"]) == r["score"]


def test_edl_profile_derived_from_operating_data_matches_static(db_rows):
    derived = derive_from_operating_data(db_rows["lanes"], db_rows["partners"], db_rows["machines"])
    static = static_profiles()["edl"]
    for k, v in derived.items():
        assert v == static[k], k


def test_no_signals_means_no_delay(db_rows):
    rows = dict(db_rows, signals=[])
    risks, _ = run(rows, "qss")
    assert all(r["expected_transit_days"] <= r["normal_transit_days"] * 1.1 for r in risks)
    assert all(r["days_to_line_stop"] is None for r in risks)
