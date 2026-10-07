import scheduled
from tests.test_notify import make_db
from tests.test_sources import FakeDB


def test_auto_resolve_green_pairs_and_notify_customer_once(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    db = make_db([dict(id="a1", customer_id="qss", supplier_id="hmo", level="amber", status="acknowledged", title="t", message="m",
                       line_stop_exposure_eur=0, supplier_response=None),
                  dict(id="a2", customer_id="qss", supplier_id="zzz", level="red", status="new", title="t", message="m",
                       line_stop_exposure_eur=0, supplier_response=None),
                  dict(id="a3", customer_id="qss", supplier_id="hmo", level="amber", status="resolved", title="t", message="m",
                       line_stop_exposure_eur=0, supplier_response=None)])
    db.t["risks"] = [{"customer_id": "qss", "supplier_id": "hmo", "level": "green"},
                     {"customer_id": "qss", "supplier_id": "zzz", "level": "red"}]
    assert scheduled.auto_resolve(db) == {"resolved": 1, "notified": 1}
    a = {r["id"]: r for r in db.t["alerts"]}
    assert (a["a1"]["status"], a["a1"]["resolved_by"]) == ("resolved", "engine") and a["a2"]["status"] == "new"
    assert "resolved_by" not in a["a3"]
    (n,) = db.t["alert_notifications"]
    assert (n["reason"], n["audience"], n["status"]) == ("auto-resolved", "customer", "dry-run")
    assert scheduled.auto_resolve(db) == {"resolved": 0, "notified": 0}


class StubSource:
    marks_stale = True
    source_id = "open-meteo"

    def __init__(self, rows=None, boom=False):
        self.rows, self.boom = rows or [], boom

    def fetch(self):
        if self.boom:
            raise RuntimeError("network down")
        return self.rows


def row(id):
    return {"id": id, "source_id": "open-meteo", "active": True}


def test_ingest_marks_stale_and_survives_a_failing_source(monkeypatch):
    db = FakeDB(signals=[row("om-old")])
    srcs = {"open-meteo": StubSource([row("om-new")]), "smn": StubSource(boom=True)}
    monkeypatch.setattr(scheduled, "get_source", lambda name, payload, db: srcs[name])
    errors = []
    out = scheduled.ingest_signals(db, ["open-meteo", "smn"], errors)
    assert out["open-meteo"] == {"upserted": 1, "marked_inactive": 1} and out["smn"]["error"] is True
    assert {r["id"]: r["active"] for r in db.t["signals"]} == {"om-old": False, "om-new": True}
    assert errors[0]["step"] == "ingest:smn" and "network down" in errors[0]["error"]


def test_failed_source_does_not_retire_signals(monkeypatch):
    db = FakeDB(signals=[row("om-old")])
    monkeypatch.setattr(scheduled, "get_source", lambda *a: StubSource(boom=True))
    scheduled.ingest_signals(db, ["open-meteo"], [])
    assert db.t["signals"][0]["active"] is True


def test_default_sources(monkeypatch):
    monkeypatch.delenv("SIGNAL_SOURCES", raising=False)
    assert scheduled.enabled_sources() == ["weather", "tomtom", "cbp", "theft", "file"]
    monkeypatch.setenv("SIGNAL_SOURCES", "file, smn")
    assert scheduled.enabled_sources() == ["file", "smn"]


def test_run_hourly_end_to_end_with_fakes(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("SIGNAL_SOURCES", "open-meteo")
    db = make_db([])
    db.t["signals"] = []
    monkeypatch.setattr(scheduled, "get_source", lambda *a: StubSource([row("om-1")]))

    def fake_recompute(db_, as_of=None):   # the engine creating a red alert
        db_.t["alerts"].append(dict(id="alert-hmo-qss", customer_id="qss", supplier_id="hmo", level="red", status="new", title="t",
                                    message="m", line_stop_exposure_eur=1, supplier_response=None))
        return {"customers": [{"alerts_created": 1, "alerts_updated": 0}]}

    monkeypatch.setattr(scheduled, "recompute_all", fake_recompute)
    s = scheduled.run_hourly(db)
    assert s["errors"] == [] and s["signals"]["open-meteo"]["upserted"] == 1
    assert s["recompute"] == {"customers": 1, "alerts_created": 1, "alerts_updated": 0}
    assert s["auto_resolve"]["resolved"] == 0 and s["notify"]["by_status"] == {"dry-run": 2}


def test_run_hourly_records_recompute_error_and_skips_notify(monkeypatch):
    monkeypatch.setattr(scheduled, "get_source", lambda *a: StubSource([]))
    db = make_db([])
    monkeypatch.setattr(scheduled, "recompute_all", lambda *a: (_ for _ in ()).throw(RuntimeError("db down")))
    s = scheduled.run_hourly(db)
    assert s["errors"][0]["step"] == "recompute" and "notify" not in s


def test_drain_stops_when_idle_or_at_max(monkeypatch):
    queue = [{"status": "done", "job_id": i, "kind": "recompute-risk"} for i in range(3)]
    monkeypatch.setattr(scheduled.jobs, "run_next", lambda db: queue.pop(0) if queue else {"status": "idle"})
    assert scheduled.drain_jobs(None, max_jobs=2)["ran"] == 2
    out = scheduled.drain_jobs(None, max_jobs=20)
    assert out["ran"] == 1 and out["idle"] is True


def test_ingest_signals_passes_on_a_source_status(monkeypatch):
    class Quiet:
        name, source_id, marks_stale = "tomtom", "tomtom", True
        summary = {"mode": "dry-run", "reason": "TOMTOM_API_KEY is not set"}

        def fetch(self):
            return []

    monkeypatch.setattr(scheduled, "get_source", lambda name, payload, db: Quiet())
    db = FakeDB(signals=[])
    out = scheduled.ingest_signals(db, ["tomtom"])
    assert out["tomtom"]["status"]["mode"] == "dry-run" and out["tomtom"]["upserted"] == 0
