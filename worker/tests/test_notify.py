"""Notifications: recipients, dry-run without a key, idempotence, escalation. Resend is mocked."""
import json

import httpx

from notify import dispatch, notify_after_recompute, send_email
from tests.test_sources import FakeDB


def alert(id="alert-hmo-qss", level="red", status="new", **kw):
    return dict(id=id, customer_id="qss", supplier_id="hmo", level=level, status=status, title="Transit from Orizaba goes from 2 to 5 days",
                message="QSS holds 3 days of cover.", line_stop_exposure_eur=480000, supplier_response=None, **kw)


def make_db(alerts, contacts=True):
    return FakeDB(
        alerts=alerts, alert_notifications=[],
        companies=[{"id": "qss", "name": "QSS", "contact": {"email": "a.ruiz@qss.example"} if contacts else None},
                   {"id": "hmo", "name": "Hules y Mangueras de Orizaba", "contact": {"email": "ops@hmo.example"}}],
        risks=[{"customer_id": "qss", "supplier_id": "hmo", "level": "red", "days_to_line_stop": 2}])


def test_dry_run_without_key_and_two_recipients(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    db = make_db([alert()])
    res = notify_after_recompute(db, before={})
    rows = db.t["alert_notifications"]
    assert res["by_status"] == {"dry-run": 2} and res["by_reason"]["new-alert"] == 2
    assert {(r["audience"], r["recipient"], r["reason"], r["status"], r["channel"]) for r in rows} == {
        ("customer", "a.ruiz@qss.example", "new-alert", "dry-run", "email"),
        ("supplier", "ops@hmo.example", "new-alert", "dry-run", "email")}


def test_idempotent_second_run_sends_nothing(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    db = make_db([alert()])
    notify_after_recompute(db, before={})
    again = notify_after_recompute(db, before={})
    assert again["recorded"] == 0 and len(db.t["alert_notifications"]) == 2


def test_no_notification_for_unchanged_existing_alert(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    db = make_db([alert()])
    assert notify_after_recompute(db, before={"alert-hmo-qss": {"level": "red", "status": "new"}})["recorded"] == 0


def test_level_up_notifies_both_once(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    db = make_db([alert(level="red")])
    res = notify_after_recompute(db, before={"alert-hmo-qss": {"level": "amber", "status": "new"}})
    assert res["by_reason"]["level-up"] == 2
    assert notify_after_recompute(db, before={"alert-hmo-qss": {"level": "amber", "status": "new"}})["recorded"] == 0


def test_supplier_response_goes_to_customer_only_once(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    a = alert(status="supplier-responded")
    a["supplier_response"] = {"by": "Roberto", "message": "Capacity confirmed."}
    db = make_db([a])
    before = {"alert-hmo-qss": {"level": "red", "status": "acknowledged"}}
    assert notify_after_recompute(db, before)["by_reason"]["supplier-responded"] == 1
    r = db.t["alert_notifications"][0]
    assert r["audience"] == "customer" and r["reason"] == "supplier-responded"
    assert notify_after_recompute(db, before)["recorded"] == 0


def test_resolved_alerts_are_not_notified(monkeypatch):
    db = make_db([alert(status="resolved")])
    assert notify_after_recompute(db, {})["recorded"] == 0


def test_missing_contact_is_skipped_and_recorded(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    db = make_db([alert()], contacts=False)
    notify_after_recompute(db, {})
    skipped = [r for r in db.t["alert_notifications"] if r["status"] == "skipped"]
    assert len(skipped) == 1 and skipped[0]["audience"] == "customer"


def test_resend_call_shape_and_body(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    monkeypatch.setenv("NOTIFY_FROM", "FlowTwin <a@x.example>")
    monkeypatch.setenv("APP_URL", "https://app.example/")
    seen = []

    def handler(req):
        seen.append((req.url.path, req.headers["authorization"], json.loads(req.content)))
        return httpx.Response(200, json={"id": "1"})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    db = make_db([alert()])
    res = notify_after_recompute(db, {}, client=client)
    assert res["by_status"] == {"sent": 2}
    path, auth, body = next(s for s in seen if s[2]["to"] == ["a.ruiz@qss.example"])
    assert path == "/emails" and auth == "Bearer re_test" and body["from"] == "FlowTwin <a@x.example>"
    assert "https://app.example/#alerts" in body["text"] and "about 2 days" in body["text"] and "EUR 480k" in body["text"]
    sup = next(s for s in seen if s[2]["to"] == ["ops@hmo.example"])[2]
    assert "https://app.example/#my-risk" in sup["text"] and "<a href=" in sup["html"]


def test_failed_send_is_recorded_and_retried(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    bad = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(422, json={"message": "bad"})))
    db = make_db([alert()])
    assert notify_after_recompute(db, {}, client=bad)["by_status"] == {"failed": 2}
    good = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    assert dispatch.load_existing(db) == set()          # failures do not block a retry
    assert notify_after_recompute(db, {}, client=good)["by_status"] == {"sent": 2}
    assert notify_after_recompute(db, {}, client=good)["recorded"] == 0
    assert send_email("a@b.example", "s", "t", "<p>t</p>", good) == ("sent", None)
