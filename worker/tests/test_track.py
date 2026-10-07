"""Twin track record (WP3): outcome rules on hand-built timelines, snapshot idempotency, evaluate writing rows."""
from datetime import date

import track
from track import rules
from tests.test_sources import FakeDB

TODAY = date(2026, 10, 5)
PART = "part-qss-6120-lmb"


def alert(**kw):
    a = dict(id="alert-hmo-qss", customer_id="qss", supplier_id="hmo", part_ids=[PART], created_at="2026-09-20",
             expected_shortfall_date="2026-09-24", status="acknowledged", chosen_action_id=None, supplier_response=None,
             actions=[{"id": "act-hmo-1", "label": "Pull the next order forward", "description": "…"}])
    a.update(kw)
    return a


def receipt(promised, received, ordered=100, got=100, part=PART, po="PO-1", **kw):
    return dict(id=po, customer_id="qss", supplier_id="hmo", part_id=part, po_number=po, promised_date=promised,
                received_date=received, quantity_ordered=ordered, quantity_received=got, **kw)


def notice(arrival, part=PART, ref="ASN-1"):
    return dict(id=1, customer_id="qss", supplier_id="hmo", part_id=part, quantity=500, ship_date=arrival,
                expected_arrival=arrival, source="edi", source_ref=ref)


def judge(a, receipts=(), notices=(), stockouts=()):
    p = rules.predicted_stop_date(a)
    return rules.judge(a, p, list(receipts), list(notices), list(stockouts), TODAY)


# ---------------------------------------------------------------- predicted stop date and due date
def test_predicted_stop_date_prefers_shortfall_then_history():
    assert rules.predicted_stop_date(alert()) == date(2026, 9, 24)
    a = alert(expected_shortfall_date=None)
    assert rules.predicted_stop_date(a) is None  # no history: nothing predicted
    h = {"part_stop_days": {PART: 3, "other": 1}, "days_to_line_stop": 5}
    assert rules.predicted_stop_date(a, h) == date(2026, 9, 23)   # the alert's own part, not 'other'
    assert rules.predicted_stop_date(a, {"part_stop_days": {}, "days_to_line_stop": 5}) == date(2026, 9, 25)
    assert rules.predicted_stop_date(a, {"part_stop_days": {PART: None}, "days_to_line_stop": None}) is None


def test_due_only_once_the_stop_date_is_a_day_past():
    assert rules.is_due(date(2026, 10, 4), TODAY)
    assert not rules.is_due(date(2026, 10, 5), TODAY)
    assert not rules.is_due(None, TODAY)


# ---------------------------------------------------------------- outcomes
def test_hit_on_late_receipt_in_window():
    out, ev = judge(alert(), [receipt("2026-09-23", "2026-09-26")])
    assert out == "hit"
    assert ev[0]["kind"] == "receipt" and ev[0]["ref"] == "PO-1" and "late by 3 days" in ev[0]["note"]


def test_hit_on_short_receipt_and_on_stockout():
    out, ev = judge(alert(), [receipt("2026-09-22", "2026-09-22", ordered=100, got=60)])
    assert out == "hit" and "short: 60 of 100" in ev[0]["note"]
    out, ev = judge(alert(), [], [], [{"part_id": PART, "date": "2026-09-24", "ref": "LS-7", "note": "Line stop log"}])
    assert out == "hit" and ev[0]["ref"] == "LS-7"


def test_hit_on_receipt_never_received():
    out, ev = judge(alert(), [receipt("2026-09-23", None, got=0)])
    assert out == "hit" and ev[0]["note"] == "not received"


def test_hit_even_when_someone_acted_keeps_the_action_as_evidence():
    out, ev = judge(alert(chosen_action_id="act-hmo-1"), [receipt("2026-09-23", "2026-09-25")])
    assert out == "hit" and [e["kind"] for e in ev] == ["receipt", "action"]


def test_prevented_when_customer_acted_and_deliveries_were_on_time():
    out, ev = judge(alert(chosen_action_id="act-hmo-1"), [receipt("2026-09-23", "2026-09-23")])
    assert out == "prevented"
    assert ev[0] == {"kind": "action", "ref": "act-hmo-1", "date": None, "note": "Customer chose: Pull the next order forward"}
    assert ev[1]["kind"] == "receipt" and ev[1]["note"] == "On time and complete"


def test_prevented_when_supplier_confirmed_capacity():
    resp = {"by": "Ana", "at": "2026-09-21", "message": "Extra truck", "confirmedCapacity": True}
    out, ev = judge(alert(supplier_response=resp), [receipt("2026-09-22", "2026-09-21")])
    assert out == "prevented" and ev[0]["ref"] == "supplier-response" and ev[0]["date"] == "2026-09-21"


def test_supplier_response_without_capacity_is_not_an_action():
    resp = {"by": "Ana", "at": "2026-09-21", "message": "Cannot", "confirmedCapacity": False}
    assert judge(alert(supplier_response=resp), [receipt("2026-09-22", "2026-09-22")])[0] == "false-alarm"


def test_false_alarm_when_on_time_and_no_action():
    out, ev = judge(alert(), [receipt("2026-09-21", "2026-09-21", po="A"), receipt("2026-09-24", "2026-09-23", po="B")])
    assert out == "false-alarm" and [e["ref"] for e in ev] == ["A", "B"]


def test_shipment_notice_alone_covers_the_window():
    out, ev = judge(alert(), [], [notice("2026-09-23")])
    assert out == "false-alarm" and ev[0]["kind"] == "shipment-notice" and ev[0]["ref"] == "ASN-1"


def test_unknown_when_no_receipts_or_notices_for_the_parts():
    out, ev = judge(alert(chosen_action_id="act-hmo-1"), [receipt("2026-09-23", "2026-09-27", part="other-part")])
    assert out == "unknown" and "No receipts or shipment notices" in ev[0]["note"]


def test_window_edges_are_plus_minus_one_day():
    a = alert()  # raised 20 Sep, stop predicted 24 Sep -> window 19..25 Sep
    assert rules.window(a, date(2026, 9, 24)) == (date(2026, 9, 19), date(2026, 9, 25))
    assert judge(a, [receipt("2026-09-25", "2026-09-27")])[0] == "hit"        # last day in
    assert judge(a, [receipt("2026-09-26", "2026-09-28")])[0] == "unknown"    # one day after: outside
    assert judge(a, [receipt("2026-09-19", "2026-09-21")])[0] == "hit"        # first day in
    assert judge(a, [receipt("2026-09-18", "2026-09-21")])[0] == "unknown"    # one day before: outside


# ---------------------------------------------------------------- misses
def test_miss_when_no_alert_in_the_three_days_before():
    late = receipt("2026-09-28", "2026-09-30", po="L1")
    misses = rules.find_misses([], [late], [], TODAY)
    assert len(misses) == 1 and misses[0]["part_id"] == PART and misses[0]["date"] == "2026-09-28"
    assert misses[0]["evidence"][0]["ref"] == "L1"
    warned = alert(created_at="2026-09-25", expected_shortfall_date=None)       # 3 days before: warned
    assert rules.find_misses([warned], [late], [], TODAY) == []
    early = alert(created_at="2026-09-24", expected_shortfall_date=None)        # 4 days before: too early
    assert len(rules.find_misses([early], [late], [], TODAY)) == 1
    other = alert(created_at="2026-09-27", part_ids=["other-part"])             # alert for another part
    assert len(rules.find_misses([other], [late], [], TODAY)) == 1


def test_problem_inside_an_alerts_window_is_not_a_miss():
    a = alert()  # window 19..25 Sep
    late = receipt("2026-09-25", "2026-09-27")
    assert rules.find_misses([a], [late], [], TODAY, {a["id"]: rules.window(a, date(2026, 9, 24))}) == []


def test_stockout_and_on_time_receipts_for_misses():
    assert rules.find_misses([], [receipt("2026-09-28", "2026-09-28")], [], TODAY) == []
    so = {"customer_id": "qss", "supplier_id": "hmo", "part_id": PART, "date": "2026-10-01", "ref": "LS-1"}
    assert rules.find_misses([], [], [so], TODAY)[0]["evidence"][0]["ref"] == "LS-1"
    assert rules.find_misses([], [receipt("2026-10-05", None)], [], TODAY) == []   # today: not yet late


# ---------------------------------------------------------------- snapshot
RISK = dict(customer_id="qss", supplier_id="hmo", level="red", score=82, days_to_line_stop=2,
            part_stop_days={PART: 2}, projection=[{"day": 0}], drivers=[{"kind": "weather"}], flex={}, updated_at="2026-10-05")


def test_snapshot_is_idempotent_and_queues_one_evaluate_job_per_day():
    db = FakeDB(app_settings=[{"id": 1, "as_of": "2026-10-05"}], risks=[RISK, {**RISK, "supplier_id": "edl", "level": "amber"}])
    s1 = track.snapshot(db)
    assert s1 == {"as_of": "2026-10-05", "rows": 2, "first_of_day": True, "queued_evaluate": True}
    h = db.t["risk_history"]
    assert len(h) == 2 and h[0]["level"] == "red" and h[0]["part_stop_days"] == {PART: 2} and "flex" not in h[0]
    db.t["risks"][0]["score"] = 90
    s2 = track.snapshot(db)
    assert s2["first_of_day"] is False and s2["queued_evaluate"] is False
    assert len(db.t["risk_history"]) == 2 and db.t["risk_history"][0]["score"] == 90   # upsert, not a new row
    jobs = db.t["jobs"]
    assert len(jobs) == 1 and jobs[0]["kind"] == "evaluate-alerts" and jobs[0]["company_id"] is None
    track.snapshot(db, "2026-10-06")
    assert len(db.t["risk_history"]) == 4 and len(db.t["jobs"]) == 2


# ---------------------------------------------------------------- evaluate
def test_evaluate_writes_outcomes_with_evidence():
    alerts = [
        alert(id="a-hit"),
        alert(id="a-prev", supplier_id="edl", part_ids=["p-edl"], chosen_action_id="act-hmo-1"),
        alert(id="a-unknown", supplier_id="tsr", part_ids=["p-tsr"]),
        alert(id="a-pending", expected_shortfall_date="2026-10-07", created_at="2026-10-05"),
        alert(id="a-watch", supplier_id="pip", part_ids=["p-pip"], expected_shortfall_date=None, created_at="2026-09-20"),
        alert(id="a-hist", supplier_id="rdp", part_ids=["p-rdp"], expected_shortfall_date=None, created_at="2026-09-20"),
    ]
    receipts = [receipt("2026-09-23", "2026-09-26"),
                {**receipt("2026-09-23", "2026-09-23", part="p-edl"), "supplier_id": "edl"},
                {**receipt("2026-09-22", "2026-09-22", part="p-rdp", po="R"), "supplier_id": "rdp"},
                receipt("2026-09-30", "2026-10-02", part="p-loose", po="MISS")]
    history = [{"customer_id": "qss", "supplier_id": "rdp", "as_of": "2026-09-20", "part_stop_days": {"p-rdp": 2},
                "days_to_line_stop": 2, "level": "red", "score": 70}]
    db = FakeDB(app_settings=[{"id": 1, "as_of": "2026-10-05"}], alerts=alerts, receipts=receipts,
                shipment_notices=[], alert_outcomes=[], risk_history=history)
    res = track.evaluate(db, {"kind": "evaluate-alerts", "company_id": None, "payload": {}})
    rows = {r["alert_id"]: r for r in db.t["alert_outcomes"]}
    assert {k: rows[k]["outcome"] for k in rows} == {"a-hit": "hit", "a-prev": "prevented", "a-unknown": "unknown",
                                                     "a-pending": "pending", "a-hist": "false-alarm"}
    assert "a-watch" not in rows and res["no_prediction"] == 1
    assert rows["a-hist"]["predicted_stop_date"] == "2026-09-22"
    r = rows["a-hit"]
    assert r["rule_version"] == "v1" and r["evaluated_at"] and r["part_ids"] == [PART]
    assert r["evidence"][0]["kind"] == "receipt" and "late" in r["evidence"][0]["note"]
    assert res["outcomes"] == {"hit": 1, "prevented": 1, "false-alarm": 1, "unknown": 1, "pending": 1}
    assert res["misses_found"] == 1 and res["misses"][0]["part_id"] == "p-loose" and res["misses_stored"] == 1
    m = db.t["missed_events"][0]
    assert (m["customer_id"], m["supplier_id"], m["part_id"], m["event_date"]) == ("qss", "hmo", "p-loose", "2026-09-30")
    assert m["evidence"][0]["ref"] == "MISS" and m["rule_version"] == "v1"

    # A second run keeps final verdicts, re-checks unknown and pending.
    db.t["receipts"].append({**receipt("2026-09-23", "2026-09-23", part="p-tsr", po="T"), "supplier_id": "tsr"})
    res2 = track.evaluate(db, {"kind": "evaluate-alerts", "company_id": None, "payload": {"as_of": "2026-10-09"}})
    rows = {r["alert_id"]: r for r in db.t["alert_outcomes"]}
    assert rows["a-unknown"]["outcome"] == "false-alarm" and rows["a-pending"]["outcome"] == "unknown"
    assert res2["kept"] == 3 and res2["written"] == 2
    assert len(db.t["missed_events"]) == 1  # the same miss is upserted, not duplicated


def test_evaluate_job_is_dispatched_and_scoped_to_one_customer():
    import jobs
    db = FakeDB(app_settings=[{"id": 1, "as_of": "2026-10-05"}],
                alerts=[alert(), alert(id="a-other", customer_id="slp-interiors")], receipts=[], shipment_notices=[],
                alert_outcomes=[], risk_history=[])
    res = jobs.run_job(db, {"kind": "evaluate-alerts", "company_id": "qss", "payload": {}})
    assert res["customer_id"] == "qss" and [r["alert_id"] for r in db.t["alert_outcomes"]] == ["alert-hmo-qss"]
    assert db.t["alert_outcomes"][0]["outcome"] == "unknown"
