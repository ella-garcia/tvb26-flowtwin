"""Supplier profiles: derivation from receipts, DB rows vs JSON fallback, engine still reproduces the seed."""
from datetime import date

import pytest

from engine import compute_customer
from engine.otif import otif_series
from engine.profiles import build_supplier, derive_profile_from_receipts, static_profiles

AS_OF = date(2026, 10, 5)  # a Monday


def rc(promised, received, ordered=100, got=100, **kw):
    return dict(promised_date=promised, received_date=received, quantity_ordered=ordered, quantity_received=got, **kw)


def test_otif_definition_and_weekly_buckets():
    lines = [rc("2026-09-30", "2026-09-30"),             # on time, in full  (week of 09-28)
             rc("2026-09-29", "2026-10-02"),             # late              (week of 09-28)
             rc("2026-09-22", "2026-09-22", got=80),     # short             (week of 09-21)
             rc("2026-09-23", "2026-09-22"),             # early, in full    (week of 09-21)
             rc("2026-09-25", None),                     # due, still open -> miss (week of 09-21)
             rc("2026-10-20", None)]                     # not yet due -> ignored
    d = derive_profile_from_receipts(lines, AS_OF)
    w = d["otif_weekly"]
    assert len(w) == 12 and d["data_status"] == "connected" and d["n_lines"] == 6
    assert w[-3] == pytest.approx(0.333, abs=1e-3)   # week of 09-21: 1 of 3
    assert w[-2] == 0.5                              # week of 09-28: 1 of 2
    assert w[-1] == 0.5                              # week of 10-05 has no lines: previous week carried
    assert w[0] == w[-3]                             # leading empty weeks take the first observed value


def test_no_receipts_is_not_connected():
    d = derive_profile_from_receipts([], AS_OF)
    assert d["data_status"] == "public-only" and d["otif_weekly"] == [] and d["lead_time_variability"] is None


def test_lateness_variability_and_lead_time():
    # lateness 0, 0, 3, 3 days -> sample stdev 1.732; reference lead 7 + mean lateness 1.5 = 8.5
    lines = [rc("2026-09-01", "2026-09-01"), rc("2026-09-08", "2026-09-08"), rc("2026-09-15", "2026-09-18"),
             rc("2026-09-22", "2026-09-25")]
    d = derive_profile_from_receipts(lines, AS_OF, reference_lead_days=7)
    assert d["lead_time_mean_days"] == 8.5
    assert d["lead_time_variability"] == pytest.approx(1.732 / 8.5, abs=1e-3)


def test_true_lead_time_when_order_date_present():
    lines = [rc("2026-09-10", "2026-09-10", order_date="2026-09-01"), rc("2026-09-20", "2026-09-22", order_date="2026-09-10"),
             rc("2026-09-25", "2026-09-25", order_date="2026-09-15")]
    d = derive_profile_from_receipts(lines, AS_OF)
    assert d["lead_time_mean_days"] == pytest.approx((9 + 12 + 10) / 3, abs=0.01)


def test_variability_needs_three_received_lines():
    d = derive_profile_from_receipts([rc("2026-09-01", "2026-09-02"), rc("2026-09-08", None)], AS_OF)
    assert d["lead_time_variability"] is None


def comps_and_parts(db_rows):
    comps = {c["id"]: c for c in db_rows["companies"]}
    return comps, [p for p in db_rows["parts"] if p["customer_id"] == "qss"]


def seed_profile_row(cid, sid):
    p = static_profiles()[sid]
    return dict(customer_id=cid, supplier_id=sid, highways=p["highways"], lead_time_variability=p["lead_time_variability"],
                utilization=p["utilization"], capacity_ceiling=p["ceiling"], finished_goods_days=p["fg_days"],
                bottleneck=p["bottleneck"], otif_weekly=otif_series(sid, p["otif"]), data_status=p["data_status"], source="seed",
                route=p.get("route"))


def test_db_profile_rows_reproduce_json_results(db_rows):
    comps, parts = comps_and_parts(db_rows)
    sids = {p["supplier_id"] for p in parts}
    a = {s: build_supplier(comps[s]) for s in sids}
    b = {s: build_supplier(comps[s], profile_row=seed_profile_row("qss", s)) for s in sids}
    ra, _ = compute_customer(comps["qss"], a, parts, db_rows["signals"], db_rows["settings"], AS_OF)
    rb, _ = compute_customer(comps["qss"], b, parts, db_rows["signals"], db_rows["settings"], AS_OF)
    assert ra == rb
    byid = {r["supplier_id"]: r for r in rb}
    assert byid["hmo"]["level"] == "red" and byid["hmo"]["days_to_line_stop"] == 2 and byid["edl"]["level"] == "amber"


def test_row_overrides_json_and_json_ignored_when_row_exists(db_rows):
    comp = {c["id"]: c for c in db_rows["companies"]}["hmo"]
    s = build_supplier(comp, profile_row=dict(supplier_id="hmo", lead_time_variability=0.5, otif_weekly=[0.9] * 12, data_status="connected"))
    assert s["lead_time_variability"] == 0.5 and s["otif_trend"] == [0.9] * 12
    assert s["utilization"] == 0.75 and s["bottleneck"].startswith("Unknown")   # JSON not used when a row exists
    assert build_supplier(comp)["utilization"] == 0.91                            # JSON fallback without a row


def test_empty_weekly_falls_back_to_otif_spec(db_rows):
    comp = {c["id"]: c for c in db_rows["companies"]}["hmo"]
    s = build_supplier(comp, profile_row=dict(supplier_id="hmo", otif_weekly=[], data_status="public-only"))
    assert "otif_trend" not in s and s["data_status"] == "public-only"
