"""Supplier profile: the inputs the engine needs that are not columns of `companies`.

Source order: operating data in the DB (machines, partners, outbound lanes) when the supplier has uploaded it,
else the static profile in worker/data/supplier_profiles.json (the v0 seed assumptions), else neutral defaults.
GAP: the schema has no table for lead-time variability, utilisation, practical ceiling or finished-goods cover of
suppliers without operating data. Recommended: a `supplier_profiles` table (see worker/README.md).
"""
import json
import os

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "supplier_profiles.json")
_STATIC = None
DEFAULTS = dict(highways=[], lead_time_variability=0.2, utilization=0.75, ceiling=0.95, fg_days=1.0,
                bottleneck="Unknown (estimated)", otif=[0.95, 0.95, "flat"])


def static_profiles() -> dict:
    global _STATIC
    if _STATIC is None:
        with open(_PATH, encoding="utf-8") as f:
            _STATIC = json.load(f)
    return _STATIC


def derive_from_operating_data(lanes, partners, machines) -> dict:
    """Profile fields that operating data determines. Empty dict when there is nothing to derive from."""
    out = {}
    hw = sorted({l["highway"] for l in lanes if l.get("direction") == "outbound" and l.get("highway")})
    if hw:
        out["highways"] = hw
    var = [float(p["lead_time_variability"]) for p in partners
           if p.get("role") == "supplier" and p.get("lead_time_variability") is not None]
    if var:
        out["lead_time_variability"] = max(var)
    if machines:
        m = max(machines, key=lambda m: float(m["utilization"]))
        out["utilization"] = float(m["utilization"])
        out["bottleneck"] = m["name"]
    return out


def build_supplier(company, lanes=(), partners=(), machines=(), invites=()) -> dict:
    prof = {**DEFAULTS, **static_profiles().get(company["id"], {}), **derive_from_operating_data(lanes, partners, machines)}
    status = prof.get("data_status")
    if not status:
        status = "connected" if (machines or lanes) else ("invited" if invites else "public-only")
    return {**company, **prof, "data_status": status}
