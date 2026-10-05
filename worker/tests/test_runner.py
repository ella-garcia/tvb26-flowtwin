"""risk_runner against an in-memory fake DB seeded from seed.json (checks the load/compute/write glue)."""
import risk_runner


class MemDB:
    def __init__(self, tables):
        self.t = tables
        self.upserts, self.updates = {}, []

    def select(self, table, params=None):
        rows = self.t.get(table, [])
        for k, v in (params or {}).items():
            if k in ("select", "order", "limit"):
                continue
            if v.startswith("eq."):
                as_text = lambda x: str(x).lower() if isinstance(x, bool) else str(x)  # PostgREST writes booleans as true/false
                rows = [r for r in rows if as_text(r.get(k)) == v[3:]]
            elif v.startswith("in.("):
                allowed = v[4:-1].split(",")
                rows = [r for r in rows if r.get(k) in allowed]
        return rows

    def upsert(self, table, rows, on_conflict):
        self.upserts.setdefault(table, []).extend(rows)

    def update(self, table, match, values):
        self.updates.append((table, match, values))
        return [values]


def test_recompute_customer_writes_risks_and_alerts(db_rows, seed):
    sigs = [{**{k: v for k, v in s.items() if k != "short"}, "active": True} for s in db_rows["signals"]]
    existing = [{"id": "alert-hmo-qss", "customer_id": "qss"}]
    db = MemDB(dict(app_settings=[dict(id=1, as_of="2026-10-05", line_stop_cost_eur_per_minute=15000, contract_demand_swing=0.15,
                                       line_hours_per_day=16)],
                    companies=db_rows["companies"], parts=db_rows["parts"], signals=sigs, alerts=existing,
                    lanes=[], partners=[], machines=[], invites=[]))
    res = risk_runner.recompute_customer(db, "qss")
    assert res["levels"]["hmo"] == "red" and res["risks"] == 11
    assert len(db.upserts["risks"]) == 11
    assert res["alerts_updated"] == 1 and res["alerts_created"] >= 4
    # an existing alert is only updated in engine-owned fields
    _, match, values = db.updates[0]
    assert match == {"id": "alert-hmo-qss"} and "status" not in values and "actions" not in values
