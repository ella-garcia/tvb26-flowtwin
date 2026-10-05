"""Supplier profile: the inputs the engine needs that are not columns of `companies`.

Source order (later wins):
  1. neutral DEFAULTS
  2. worker/data/supplier_profiles.json (v0 seed assumptions), ONLY when the supplier_profiles table has no row for the pair
  3. the supplier_profiles row (non-null columns), one per (customer, supplier)
  4. operating data the supplier uploaded (outbound lane highways, partner lead-time variability, machine utilisation)

derive_profile_from_receipts() computes the receipt-driven part of a profile (see its docstring for the definitions).
"""
import json
import math
import os
from datetime import date, timedelta

_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "supplier_profiles.json")
_STATIC = None
DEFAULTS = dict(highways=[], lead_time_variability=0.2, utilization=0.75, ceiling=0.95, fg_days=1.0,
                bottleneck="Unknown (estimated)", otif=[0.95, 0.95, "flat"])
# supplier_profiles column -> engine key
ROW_FIELDS = {"highways": "highways", "lead_time_variability": "lead_time_variability", "utilization": "utilization",
              "capacity_ceiling": "ceiling", "finished_goods_days": "fg_days", "bottleneck": "bottleneck",
              "lead_time_mean_days": "lead_time_mean_days"}
NUMERIC = {"lead_time_variability", "utilization", "ceiling", "fg_days", "lead_time_mean_days"}
DEFAULT_REFERENCE_LEAD_DAYS = 7.0
MIN_LINES_FOR_VARIABILITY = 3


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


def from_profile_row(row: dict) -> dict:
    """Engine keys from a supplier_profiles row (null columns are skipped, so defaults still apply)."""
    out = {}
    for col, key in ROW_FIELDS.items():
        v = row.get(col)
        if v is None or (col == "highways" and not v):
            continue
        out[key] = float(v) if key in NUMERIC else v
    weekly = row.get("otif_weekly")
    if isinstance(weekly, str):
        weekly = json.loads(weekly)
    if weekly and len(weekly) == 12:
        out["otif_trend"] = [float(x) for x in weekly]
    return out


def build_supplier(company, lanes=(), partners=(), machines=(), invites=(), profile_row=None) -> dict:
    """Engine supplier dict. profile_row is the supplier_profiles row for (customer, supplier); None -> JSON fallback."""
    base = dict(DEFAULTS)
    if profile_row is None:
        base.update(static_profiles().get(company["id"], {}))
    else:
        base.update(from_profile_row(profile_row))
    prof = {**base, **derive_from_operating_data(lanes, partners, machines)}
    status = (profile_row or {}).get("data_status")
    if status in (None, "public-only"):
        status = prof.get("data_status")
    if not status or status == "public-only":
        status = "connected" if (machines or lanes) else ("invited" if invites else "public-only")
    return {**company, **prof, "data_status": status}


# ---------------------------------------------------------------- receipts -> profile

def _d(v):
    if v is None or v == "":
        return None
    return v if isinstance(v, date) else date.fromisoformat(str(v)[:10])


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def derive_profile_from_receipts(receipts, as_of=None, reference_lead_days=None) -> dict:
    """Receipt-driven part of a supplier profile.

    receipts: rows with promised_date, received_date (None = still open), quantity_ordered, quantity_received
              and optionally order_date (when present the true lead time is measured).
    as_of:    date (default today). Lines promised after as_of are not yet due and are ignored.

    Definitions
      lateness_i          = received_date - promised_date, in days (negative = early), for lines already received.
      lead_time_mean_days = mean(received - order_date) when order_date is given; otherwise
                            reference_lead_days (default 7, the planned lead time) + mean(lateness), floored at 0.5.
                            Receipts carry no PO date, so the reference is an assumption unless order_date exists.
      lead_time_variability = sample stdev(lateness_i) / mean lead time (coefficient of variation: how large the
                            delivery-date scatter is relative to the lead time), clamped 0..1.
                            None with fewer than 3 received lines.
      OTIF line           = received on or before promised_date AND quantity_received >= quantity_ordered.
                            A due line (promised <= as_of) that is still open counts as a miss.
      otif_weekly         = 12 values, oldest first, ending with the week (Monday-based) of as_of; each is the share of OTIF
                            lines among lines whose promised_date falls in that week. Empty weeks carry the previous
                            week forward (leading empty weeks take the first observed value). [] when no line is due.
      data_status         = 'connected' when there is at least one receipt line, else 'public-only'.
    """
    as_of = _d(as_of) or date.today()
    lines = []
    for r in receipts:
        p = _d(r.get("promised_date"))
        if p is None:
            continue
        lines.append((p, _d(r.get("received_date")), float(r.get("quantity_ordered") or 0),
                      float(r.get("quantity_received") or 0), _d(r.get("order_date"))))
    out = {"data_status": "connected" if lines else "public-only", "n_lines": len(lines),
           "lead_time_mean_days": None, "lead_time_variability": None, "otif_weekly": []}
    if not lines:
        return out
    late = [(rc - p).days for p, rc, _o, _r, _od in lines if rc is not None]
    leads = [(rc - od).days for _p, rc, _o, _r, od in lines if rc is not None and od is not None]
    ref = float(reference_lead_days) if reference_lead_days else DEFAULT_REFERENCE_LEAD_DAYS
    if leads:
        mean_lead = sum(leads) / len(leads)
    elif late:
        mean_lead = max(0.5, ref + sum(late) / len(late))
    else:
        mean_lead = None
    if mean_lead is not None:
        out["lead_time_mean_days"] = round(mean_lead, 2)
    if len(late) >= MIN_LINES_FOR_VARIABILITY and mean_lead:
        m = sum(late) / len(late)
        sd = math.sqrt(sum((x - m) ** 2 for x in late) / (len(late) - 1))
        out["lead_time_variability"] = round(min(1.0, sd / mean_lead), 3)
    # OTIF per week
    wk0 = _monday(as_of) - timedelta(weeks=11)
    buckets = [[0, 0] for _ in range(12)]  # [ok, total]
    for p, rc, ordered, got, _od in lines:
        if p > as_of:
            continue
        i = (_monday(p) - wk0).days // 7
        if not 0 <= i < 12:
            continue
        ok = rc is not None and rc <= p and got >= ordered
        buckets[i][1] += 1
        buckets[i][0] += 1 if ok else 0
    shares = [b[0] / b[1] if b[1] else None for b in buckets]
    first = next((s for s in shares if s is not None), None)
    if first is None:
        return out
    prev, series = first, []
    for s in shares:
        prev = s if s is not None else prev
        series.append(round(prev, 3))
    out["otif_weekly"] = series
    return out
