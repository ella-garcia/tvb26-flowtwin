"""Glue between the DB and the pure engine: load rows, compute, write risks and alerts."""
import json
import os
from datetime import date, datetime, timezone

from db import DB
from engine import DEFAULT_SETTINGS, compute_customer
from engine.circular import DEFAULT_FACTOR
from engine.milkrun import plan_consolidation
from engine.profiles import build_supplier

# Engine-owned alert fields; status, chosen_action_id, supplier_response and actions belong to people and are never overwritten.
ALERT_OWNED = ("level", "title", "message", "line_stop_exposure_eur", "expected_shortfall_date", "part_ids", "signal_id")


def load_settings(db: DB) -> tuple[dict, date]:
    rows = db.select("app_settings", {"id": "eq.1"})
    r = rows[0] if rows else {}
    s = {k: float(r.get(k, v)) for k, v in DEFAULT_SETTINGS.items()}
    return s, date.fromisoformat(r["as_of"]) if r.get("as_of") else date.today()


FACTOR_ID = "ef-road-artic"


def load_factor(db: DB) -> dict:
    """Latest version of the road freight emission factor; the built-in default if the table has none."""
    rows = [r for r in db.select("emission_factors", {"id": f"eq.{FACTOR_ID}"}) if r.get("id") == FACTOR_ID]
    return max(rows, key=lambda r: int(r["version"])) if rows else DEFAULT_FACTOR


def recompute_customer(db: DB, customer_id: str, as_of=None) -> dict:
    settings, default_as_of = load_settings(db)
    as_of = date.fromisoformat(as_of) if isinstance(as_of, str) else (as_of or default_as_of)
    customers = db.select("companies", {"id": f"eq.{customer_id}", "kind": "eq.customer"})
    if not customers:
        raise ValueError(f"customer {customer_id} not found")
    parts = db.select("parts", {"customer_id": f"eq.{customer_id}"})
    # A part added by a parts upload has on_hand 0 until stock is reported; without receipts either, that is
    # "no data yet", not "out of stock", so it must not raise a false line stop. Real stock-outs keep counting.
    received = {r["part_id"] for r in db.select("receipts", {"customer_id": f"eq.{customer_id}"}) if r.get("part_id")}
    parts = [p for p in parts if float(p.get("on_hand") or 0) > 0 or p["id"] in received]
    signals = db.select("signals", {"active": "eq.true"})  # retired signals no longer affect projections
    sup_ids = sorted({p["supplier_id"] for p in parts})
    suppliers = {}
    profiles = {r["supplier_id"]: r for r in db.select("supplier_profiles", {"customer_id": f"eq.{customer_id}"})}
    if sup_ids:
        ids = ",".join(sup_ids)
        companies = db.select("companies", {"id": f"in.({ids})"})
        # Capacity events are the supplier's private data: they only lower (or raise) capacity in the flex test.
        events = {}
        for e in db.select("capacity_events", {"supplier_id": f"in.({ids})"}):
            events.setdefault(e["supplier_id"], []).append(e)
        for c in companies:
            op = {t: db.select(t, {"company_id": f"eq.{c['id']}"}) for t in ("lanes", "partners", "machines")}
            invited = db.select("invites", {"supplier_id": f"eq.{c['id']}"})
            suppliers[c["id"]] = build_supplier(c, op["lanes"], op["partners"], op["machines"], invited, profiles.get(c["id"]))
            suppliers[c["id"]]["capacity_events"] = events.get(c["id"], [])
    factor = load_factor(db)
    risks, alerts = compute_customer(customers[0], suppliers, parts, signals, settings, as_of, factor)
    db.upsert("risks", risks, "customer_id,supplier_id")
    now = datetime.now(timezone.utc).isoformat()
    plan = plan_consolidation(customers[0], suppliers, {r["supplier_id"]: r.get("circular") for r in risks},
                              {r["supplier_id"]: r for r in risks}, settings, factor)
    db.upsert("consolidation_plans", [dict(customer_id=customer_id, loops=plan["loops"], totals=plan["totals"],
                                           generated_at=now, updated_at=now)], "customer_id")
    created = updated = 0
    existing = {a["id"]: a for a in db.select("alerts", {"customer_id": f"eq.{customer_id}"})}
    for a in alerts:
        if a["id"] in existing:
            patch = {k: a[k] for k in ALERT_OWNED}
            prev = existing[a["id"]]
            # An alert the engine closed when the risk turned green reopens if the risk comes back.
            # Alerts a person resolved stay resolved.
            if prev.get("status") == "resolved" and prev.get("resolved_by") == "engine" and a.get("level") != "green":
                patch.update(status="new", resolved_by=None)
            db.update("alerts", {"id": a["id"]}, patch)
            updated += 1
        else:
            db.upsert("alerts", [a], "id")
            created += 1
    return {"customer_id": customer_id, "as_of": as_of.isoformat(), "risks": len(risks), "alerts_created": created,
            "alerts_updated": updated, "levels": {r["supplier_id"]: r["level"] for r in risks}}


def recompute_all(db: DB, as_of=None) -> dict:
    out = [recompute_customer(db, c["id"], as_of) for c in db.select("companies", {"kind": "eq.customer"})]
    return {"customers": out}
