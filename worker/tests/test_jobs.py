"""Queue + file source + HTTP error mapping, against an in-memory fake of the DB client (no network)."""
import pytest

import jobs
from sources import FileSignalSource, SmnConaguaSource


class FakeDB:
    def __init__(self, queue):
        self.jobs = queue
        self.upserts, self.inserts = [], []

    def select(self, table, params=None):
        assert table == "jobs"
        q = [j for j in self.jobs if j["status"] == "queued"]
        return sorted(q, key=lambda j: j["id"])[:1]

    def update(self, table, match, values):
        out = []
        for j in self.jobs:
            if j["id"] == match["id"] and ("status" not in match or j["status"] == match["status"].removeprefix("eq.")):
                j.update(values)
                out.append(dict(j))
        return out

    def upsert(self, table, rows, on_conflict):
        self.upserts.append((table, rows, on_conflict))

    def insert(self, table, rows):
        self.inserts.append((table, rows))
        return rows


def test_claim_is_conditional_and_oldest_first():
    db = FakeDB([{"id": 2, "kind": "x", "status": "queued"}, {"id": 1, "kind": "x", "status": "queued"}])
    assert jobs.claim_next(db)["id"] == 1
    assert [j["status"] for j in sorted(db.jobs, key=lambda j: j["id"])] == ["running", "queued"]


def test_idle_when_empty():
    assert jobs.run_next(FakeDB([])) == {"status": "idle"}


def test_unknown_kind_marks_failed_with_error():
    db = FakeDB([{"id": 1, "kind": "build-twin", "status": "queued", "payload": {}}])
    res = jobs.run_next(db)
    assert res["status"] == "failed" and "not implemented" in res["error"]
    assert db.jobs[0]["status"] == "failed" and db.jobs[0]["error"]


def test_ingest_signals_upserts_and_queues_recompute():
    db = FakeDB([{"id": 1, "kind": "ingest-signals", "status": "queued", "payload": {"source": "file"}}])
    res = jobs.run_next(db)
    assert res["status"] == "done" and res["result"]["signals_upserted"] == 12
    assert db.upserts[0][0] == "signals" and db.upserts[0][2] == "id"
    assert "short" not in db.upserts[0][1][0] and "starts_at" in db.upserts[0][1][0]
    assert db.inserts[0][1][0]["kind"] == "recompute-risk"


def test_file_source_and_smn_offline():
    # SMN is a live source now (see test_sources_smn.py); with no municipal records and no company in range it yields nothing.
    assert SmnConaguaSource(records=[], companies=[]).fetch() == []
    assert len(FileSignalSource().fetch()) == 12


class FlakyDB(FakeDB):
    """Fails the first `fail` updates that try to mark a job failed."""

    def __init__(self, queue, fail):
        super().__init__(queue)
        self.fail = fail

    def update(self, table, match, values):
        if values.get("status") == "failed" and self.fail:
            self.fail -= 1
            raise RuntimeError("Supabase PATCH /rest/v1/jobs -> 503: unavailable")
        return super().update(table, match, values)


def test_failure_update_is_retried_once():
    db = FlakyDB([{"id": 1, "kind": "build-twin", "status": "queued", "payload": {}}], fail=1)
    assert jobs.run_next(db)["status"] == "failed" and db.jobs[0]["status"] == "failed"


def test_failure_update_that_keeps_failing_is_logged_and_raised(caplog):
    db = FlakyDB([{"id": 1, "kind": "build-twin", "status": "queued", "payload": {}}], fail=2)
    with pytest.raises(RuntimeError, match="503"):
        jobs.run_next(db)
    assert "could not mark job 1 failed" in caplog.text and "not implemented" in caplog.text


def _client(monkeypatch, db):
    from fastapi.testclient import TestClient
    import main
    monkeypatch.delenv("WORKER_TOKEN", raising=False)
    monkeypatch.setitem(main.app.dependency_overrides, main.get_db, lambda: db)
    return TestClient(main.app, raise_server_exceptions=False)


def test_supabase_runtime_error_is_a_502_json(monkeypatch):
    db = FlakyDB([{"id": 1, "kind": "build-twin", "status": "queued", "payload": {}}], fail=2)
    r = _client(monkeypatch, db).post("/jobs/run-next")
    assert r.status_code == 502 and r.json()["detail"] == "Supabase request failed" and "503" in r.json()["error"]


def test_httpx_error_is_a_502_and_other_runtime_errors_a_500(monkeypatch):
    import httpx
    import main

    def boom(exc):
        def f(*a, **k):
            raise exc
        return f
    client = _client(monkeypatch, FakeDB([]))
    monkeypatch.setattr(main.jobs, "run_next", boom(httpx.ConnectError("down")))
    r = client.post("/jobs/run-next")
    assert r.status_code == 502 and r.json()["detail"] == "Supabase unreachable: ConnectError"
    monkeypatch.setattr(main.scheduled, "drain_jobs", boom(NotImplementedError("x")))
    assert client.post("/jobs/drain").status_code == 500
