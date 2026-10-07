"""Alert outcome rules (WP3). Pure functions on plain dicts in DB column shape; no I/O.

The question each rule answers: an alert said "this customer's line could run short of these parts around date D".
Did that happen, did someone act and it did not happen, did nothing happen, or can we not tell?

Inputs are rows as the worker reads them:
- alert: ``id, customer_id, supplier_id, part_ids, created_at, expected_shortfall_date, status, chosen_action_id,
  actions, supplier_response {by, at, message, confirmedCapacity}``
- receipt: ``id, part_id, po_number, promised_date, received_date, quantity_ordered, quantity_received, source_ref``
- shipment notice: ``id, part_id, quantity, ship_date, expected_arrival, source, source_ref``
- stock-out: ``{part_id, date, ref, note}``; no table records stock-outs yet, so the worker passes none (the rule is
  ready for when the Tier 1 reports them, e.g. from a line-stop log).

Every verdict comes with its evidence: the receipts, notices and actions it rests on, as
``{kind: receipt|shipment-notice|action, ref, date, note}``.
"""
from datetime import date, timedelta

RULE_VERSION = "v1"
TOLERANCE_DAYS = 1      # a problem within ±1 day of the predicted window counts
MISS_LOOKBACK_DAYS = 3  # a problem is "warned" if an alert for the part was raised up to 3 days before
OUTCOMES = ("hit", "prevented", "false-alarm", "unknown")


def _d(v) -> date | None:
    if v is None or v == "":
        return None
    if isinstance(v, date):
        return v
    return date.fromisoformat(str(v)[:10])


def _num(v) -> float:
    return float(v or 0)


def predicted_stop_date(alert: dict, history_row: dict | None = None) -> date | None:
    """The date the alert said the line could run short.

    1. ``alert.expected_shortfall_date`` when the engine set one.
    2. Otherwise from the risk snapshot of the alert's creation day (``history_row``, the ``risk_history`` row of the
       pair with ``as_of = alert.created_at``): the earliest ``part_stop_days`` of the alert's parts, else
       ``days_to_line_stop``, added to the creation date.
    3. Otherwise None: the alert did not predict a stop (an amber "watch" alert), so there is nothing to check.
    """
    explicit = _d(alert.get("expected_shortfall_date"))
    if explicit:
        return explicit
    created = _d(alert.get("created_at"))
    if not history_row or not created:
        return None
    stops = history_row.get("part_stop_days") or {}
    days = [stops[p] for p in alert.get("part_ids") or [] if stops.get(p) is not None]
    if not days and history_row.get("days_to_line_stop") is not None:
        days = [history_row["days_to_line_stop"]]
    if not days:
        return None
    return created + timedelta(days=round(float(min(days))))


def window(alert: dict, predicted: date) -> tuple[date, date]:
    """The predicted window: from the day the alert was raised to the predicted stop date, widened by ±1 day.

    A delivery that was due in this window is the one that would have caused (or avoided) the stop.
    """
    created = _d(alert.get("created_at")) or predicted
    start = min(created, predicted)
    return start - timedelta(days=TOLERANCE_DAYS), predicted + timedelta(days=TOLERANCE_DAYS)


def receipt_problem(receipt: dict, today: date) -> str | None:
    """Why a receipt counts as a delivery problem, or None if it was on time and complete.

    - late: ``received_date > promised_date``, or not received at all and the promised date has passed;
    - short: ``quantity_received < quantity_ordered`` (once received).
    """
    promised, received = _d(receipt.get("promised_date")), _d(receipt.get("received_date"))
    if received is None:
        return "not received" if promised and promised < today else None
    notes = []
    if promised and received > promised:
        n = (received - promised).days
        notes.append(f"late by {n} day{'' if n == 1 else 's'}")
    if _num(receipt.get("quantity_received")) < _num(receipt.get("quantity_ordered")):
        notes.append(f"short: {_num(receipt.get('quantity_received')):g} of {_num(receipt.get('quantity_ordered')):g}")
    return ", ".join(notes) or None


def _in(d: date | None, lo: date, hi: date) -> bool:
    return d is not None and lo <= d <= hi


def receipt_evidence(receipt: dict, note: str) -> dict:
    return {"kind": "receipt", "ref": str(receipt.get("po_number") or receipt.get("source_ref") or receipt.get("id")),
            "date": str(receipt.get("received_date") or receipt.get("promised_date")), "note": note}


def notice_evidence(notice: dict, note: str) -> dict:
    return {"kind": "shipment-notice", "ref": str(notice.get("source_ref") or notice.get("id")),
            "date": str(notice.get("expected_arrival") or notice.get("ship_date")), "note": note}


def action_evidence(alert: dict) -> list[dict]:
    """What people did about the alert: the key customer's chosen action and the supplier's capacity confirmation.

    An action counts when the alert has a ``chosen_action_id`` (acknowledged with an action) or the supplier
    responded with ``confirmedCapacity = true``. Acknowledging without choosing an action is not an action.
    """
    out = []
    chosen = alert.get("chosen_action_id")
    if chosen:
        label = next((a.get("label") for a in alert.get("actions") or [] if a.get("id") == chosen), None)
        out.append({"kind": "action", "ref": chosen, "date": None,
                    "note": f"Customer chose: {label}" if label else "Customer chose an action"})
    resp = alert.get("supplier_response") or {}
    if resp.get("confirmedCapacity"):
        out.append({"kind": "action", "ref": "supplier-response", "date": resp.get("at"),
                    "note": "Supplier confirmed capacity" + (f" ({resp['by']})" if resp.get("by") else "")})
    return out


def judge(alert: dict, predicted: date, receipts: list[dict], notices: list[dict], stockouts: list[dict],
          today: date) -> tuple[str, list[dict]]:
    """Outcome of one alert whose predicted stop date has passed. Returns (outcome, evidence).

    Only rows for the alert's parts count (all of the pair's parts when the alert lists none), and only those inside
    the predicted window (``window``): receipts by promised date, notices by expected arrival, stock-outs by date.

    - **hit**: at least one delivery problem in the window: a late or short receipt (``receipt_problem``) or a
      known stock-out. The prediction came true, whether or not someone acted.
    - **unknown**: no receipts, notices or stock-outs for those parts in the window. We say so; we never guess.
    - **prevented**: no problem, and someone acted (``action_evidence``): the key customer chose an action and/or
      the supplier confirmed capacity. Deliveries then arrived on time and complete.
    - **false-alarm**: no problem and no action: deliveries in the window were on time and complete anyway.

    Shipment notices count as coverage (the supplier said it shipped for the window), but only receipts can show
    a problem: a notice is a promise, a receipt is what arrived.
    """
    lo, hi = window(alert, predicted)
    parts = set(alert.get("part_ids") or [])
    mine = (lambda r: r.get("part_id") in parts) if parts else (lambda r: True)
    rs = [r for r in receipts if mine(r) and _in(_d(r.get("promised_date")), lo, hi)]
    ns = [n for n in notices if mine(n) and _in(_d(n.get("expected_arrival") or n.get("ship_date")), lo, hi)]
    ss = [s for s in stockouts if mine(s) and _in(_d(s.get("date")), lo, hi)]

    problems = [receipt_evidence(r, p) for r in rs if (p := receipt_problem(r, today))]
    problems += [{"kind": "receipt", "ref": str(s.get("ref") or "stock-out"), "date": str(s.get("date")),
                  "note": s.get("note") or "Stock-out reported"} for s in ss]
    actions = action_evidence(alert)
    if problems:
        return "hit", problems + actions
    if not rs and not ns:
        return "unknown", [{"kind": "receipt", "ref": "none", "date": None,
                            "note": f"No receipts or shipment notices for these parts between {lo} and {hi}"}]
    covered = [receipt_evidence(r, "On time and complete") for r in rs if _d(r.get("received_date"))]
    covered += [notice_evidence(n, f"Shipped {_num(n.get('quantity')):g}, expected {n.get('expected_arrival') or 'n/a'}")
                for n in ns]
    if actions:
        return "prevented", actions + covered
    return "false-alarm", covered


def is_due(predicted: date | None, today: date) -> bool:
    """An alert is judged once its predicted stop date is at least 1 day in the past."""
    return predicted is not None and predicted <= today - timedelta(days=1)


def find_misses(alerts: list[dict], receipts: list[dict], stockouts: list[dict], today: date,
                windows: dict[str, tuple[date, date]] | None = None, lookback_days: int = 90) -> list[dict]:
    """Delivery problems nobody warned about.

    A problem is a late or short receipt (dated by its promised date) or a stock-out, in the last ``lookback_days``
    up to yesterday. It is **warned** when an alert of the same customer lists the part (or lists no parts and is
    for the same supplier) and either was raised in the ``MISS_LOOKBACK_DAYS`` (3) days before the problem, up to
    the problem day itself, or has a predicted window (``windows`` by alert id) that contains the problem date.
    Everything else is a **miss**. One miss per (customer, supplier, part, date).
    """
    windows = windows or {}
    lo = today - timedelta(days=lookback_days)
    events = []
    for r in receipts:
        d = _d(r.get("promised_date"))
        p = receipt_problem(r, today)
        if p and d and lo <= d < today:
            events.append((r.get("customer_id"), r.get("supplier_id"), r.get("part_id"), d, receipt_evidence(r, p)))
    for s in stockouts:
        d = _d(s.get("date"))
        if d and lo <= d < today:
            events.append((s.get("customer_id"), s.get("supplier_id"), s.get("part_id"), d,
                           {"kind": "receipt", "ref": str(s.get("ref") or "stock-out"), "date": str(d),
                            "note": s.get("note") or "Stock-out reported"}))

    def warned(cust, sup, part, d):
        for a in alerts:
            if a.get("customer_id") != cust:
                continue
            aparts = a.get("part_ids") or []
            if not (part in aparts or (not aparts and a.get("supplier_id") == sup)):
                continue
            created = _d(a.get("created_at"))
            if created and d - timedelta(days=MISS_LOOKBACK_DAYS) <= created <= d:
                return True
            w = windows.get(a.get("id"))
            if w and w[0] <= d <= w[1]:
                return True
        return False

    out, seen = [], set()
    for cust, sup, part, d, ev in sorted(events, key=lambda e: (str(e[0]), str(e[1]), str(e[2]), e[3])):
        key = (cust, sup, part, d)
        if key in seen or warned(cust, sup, part, d):
            continue
        seen.add(key)
        out.append({"customer_id": cust, "supplier_id": sup, "part_id": part, "date": d.isoformat(),
                    "outcome": "miss", "evidence": [ev]})
    return out
