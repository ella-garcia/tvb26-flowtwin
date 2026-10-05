"""Queue + file source, against an in-memory fake of the DB client (no network)."""
import jobs
from sources import FileSignalSource, SmnConaguaSource
import pytest


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
    assert res["status"] == "done" and res["result"]["signals_upserted"] == 8
    assert db.upserts[0][0] == "signals" and db.upserts[0][2] == "id"
    assert "short" not in db.upserts[0][1][0] and "starts_at" in db.upserts[0][1][0]
    assert db.inserts[0][1][0]["kind"] == "recompute-risk"


def test_smn_stub_is_explicit():
    with pytest.raises(NotImplementedError):
        SmnConaguaSource().fetch()
    assert len(FileSignalSource().fetch()) == 8
