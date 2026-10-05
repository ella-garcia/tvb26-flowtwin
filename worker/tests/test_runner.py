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


def test_new_part_without_stock_or_receipts_does_not_stop_the_line(db_rows):
    new = dict(id="part-qss-new", number="QSS-NEW", name="New bracket", supplier_id="mds", customer_id="qss", unit_cost_mxn=5,
               daily_usage=100, on_hand=0, days_of_cover=0, single_source=True, criticality="line-stopper")
    tables = lambda receipts: MemDB(dict(app_settings=[dict(id=1, as_of="2026-10-05", line_stop_cost_eur_per_minute=15000,
                                                            contract_demand_swing=0.15, line_hours_per_day=16)],
                                         companies=db_rows["companies"], parts=db_rows["parts"] + [new], signals=[], alerts=[],
                                         lanes=[], partners=[], machines=[], invites=[], receipts=receipts))
    risk = lambda db: next(r for r in db.upserts["risks"] if r["supplier_id"] == "mds")
    db = tables([])
    risk_runner.recompute_customer(db, "qss")
    assert risk(db)["days_to_line_stop"] is None  # stock never reported: ignored
    db = tables([dict(customer_id="qss", supplier_id="mds", part_id="part-qss-new", po_number="1")])
    risk_runner.recompute_customer(db, "qss")
    assert risk(db)["days_to_line_stop"] == 0  # deliveries on record and 0 on hand: a real stock-out
