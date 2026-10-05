"""Glue between the DB and the pure engine: load rows, compute, write risks and alerts."""
import json
import os
from datetime import date

from db import DB
from engine import DEFAULT_SETTINGS, compute_customer
from engine.profiles import build_supplier

# Engine-owned alert fields; status, chosen_action_id, supplier_response and actions belong to people and are never overwritten.
ALERT_OWNED = ("level", "title", "message", "line_stop_exposure_eur", "expected_shortfall_date", "part_ids", "signal_id")


def load_settings(db: DB) -> tuple[dict, date]:
    rows = db.select("app_settings", {"id": "eq.1"})
    r = rows[0] if rows else {}
    s = {k: float(r.get(k, v)) for k, v in DEFAULT_SETTINGS.items()}
    return s, date.fromisoformat(r["as_of"]) if r.get("as_of") else date.today()


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
        for c in companies:
            op = {t: db.select(t, {"company_id": f"eq.{c['id']}"}) for t in ("lanes", "partners", "machines")}
            invited = db.select("invites", {"supplier_id": f"eq.{c['id']}"})
            suppliers[c["id"]] = build_supplier(c, op["lanes"], op["partners"], op["machines"], invited, profiles.get(c["id"]))
    risks, alerts = compute_customer(customers[0], suppliers, parts, signals, settings, as_of)
    db.upsert("risks", risks, "customer_id,supplier_id")
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
