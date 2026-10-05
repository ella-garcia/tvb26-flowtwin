"""Validate mapped rows of one upload kind. Pure: lookups come in through `ctx`, nothing touches the database.

ctx keys
  customer_id        the Tier 1 company
  suppliers          {norm(key): supplier_id}   key = supplier id, code or name (accent/case-insensitive)
  company_ids        ids already in companies (suppliers uploads only)
  parts              {norm(part number): parts row}
  today              date (default today)
Returns (records, issues). A row with an error issue is left out of records; warnings keep the row.
"""
from datetime import date, timedelta

from .columns import (SYNONYMS, is_blank, norm, parse_bool, parse_criticality, parse_date, parse_number, slug)
from .geo import geocode

DEFAULT_REQUIREMENTS = {"otifTarget": 0.95, "ppmTarget": 100, "approvalLevel": 1, "certifications": []}


def _issue(row, column, message, severity="error"):
    return dict(row=row, column=column, message=message, severity=severity)


class _Row:
    """Access to one row through field names; collects issues."""

    def __init__(self, raw, mapping, issues):
        self.n, self.issues = raw["__row__"], issues
        self.src = {f: h for h, f in mapping.items()}
        self.raw, self.ok = raw, True

    def get(self, field, parser=None, required=False):
        h = self.src.get(field)
        v = self.raw.get(h) if h else None
        if is_blank(v):
            if required:
                self.fail(field, f"{field} is required")
            return None
        if parser is None:
            return str(v).strip() if not isinstance(v, str) else v.strip()
        try:
            return parser(v)
        except ValueError as e:
            self.fail(field, str(e))
            return None

    def fail(self, field, msg):
        self.ok = False
        self.issues.append(_issue(self.n, self.src.get(field, field), msg))

    def warn(self, field, msg, severity="warning"):
        self.issues.append(_issue(self.n, self.src.get(field, field), msg, severity))


def _supplier(r: _Row, ctx, field="supplier", required=True):
    v = r.get(field, required=required)
    if v is None:
        return None
    sid = ctx["suppliers"].get(norm(v))
    if sid is None:
        r.fail(field, f"Unknown supplier '{v}': add it in the suppliers upload first")
    return sid


def _part(r: _Row, ctx):
    v = r.get("number", required=True)
    if v is None:
        return None
    p = ctx["parts"].get(norm(v))
    if p is None:
        r.fail("number", f"Unknown part number '{v}': add it in the parts upload first")
    return p


def validate_suppliers(rows, mapping, ctx):
    recs, issues, seen = [], [], set()
    for raw in rows:
        r = _Row(raw, mapping, issues)
        name, city, state = r.get("name", required=True), r.get("city", required=True), r.get("state")
        code, email = r.get("code"), r.get("email")
        if email and ("@" not in email or " " in email):
            r.warn("email", f"'{email}' does not look like an email address")
            email = None
        geo = None
        if city:
            geo = geocode(city, state)
            if geo is None:
                r.fail("city", f"City '{city}' is not in the built-in list of Mexican cities, so it cannot be placed on the map")
        sid = None
        if name:
            sid = (ctx["suppliers"].get(norm(code)) if code else None) or ctx["suppliers"].get(norm(name)) \
                or f"{ctx['customer_id']}-{slug(code or name)}"
        if sid in seen:
            r.fail("name", f"Duplicate supplier in this file ({code or name})")
        if r.ok:
            seen.add(sid)
            recs.append(dict(row=r.n, id=sid, name=name, city=geo[0], state=geo[1], lat=geo[2], lon=geo[3], email=email,
                             code=code, existing=sid in ctx.get("company_ids", ())))
    return recs, issues


def validate_parts(rows, mapping, ctx):
    recs, issues, seen = [], [], set()
    for raw in rows:
        r = _Row(raw, mapping, issues)
        number, name = r.get("number", required=True), r.get("name", required=True)
        sid = _supplier(r, ctx)
        cost = r.get("unit_cost_mxn", parse_number, required=True)
        usage = r.get("daily_usage", parse_number, required=True)
        single = r.get("single_source", parse_bool)
        crit = r.get("criticality", parse_criticality)
        if cost is not None and cost < 0:
            r.fail("unit_cost_mxn", "Unit cost cannot be negative")
        if usage is not None and usage <= 0:
            r.fail("daily_usage", "Daily usage must be greater than 0")
        if number and norm(number) in seen:
            r.fail("number", f"Duplicate part number '{number}' in this file")
        if r.ok:
            seen.add(norm(number))
            recs.append(dict(row=r.n, number=number, name=name, supplier_id=sid, unit_cost_mxn=cost, daily_usage=usage,
                             single_source=bool(single), criticality=crit or "normal"))
    return recs, issues


def validate_stock(rows, mapping, ctx):
    issues, latest = [], {}
    today = ctx.get("today") or date.today()
    for raw in rows:
        r = _Row(raw, mapping, issues)
        p = _part(r, ctx)
        qty = r.get("on_hand", parse_number, required=True)
        as_of = r.get("as_of", parse_date)
        if qty is not None and qty < 0:
            r.fail("on_hand", "On-hand units cannot be negative")
        if as_of and as_of > today + timedelta(days=1):
            r.warn("as_of", f"As-of date {as_of} is in the future")
        if not r.ok:
            continue
        if as_of is None:
            r.warn("as_of", "No as-of date: assuming today", "info")
        key = p["id"]
        if key in latest:
            r.warn("number", f"Part '{p['number']}' appears more than once: keeping the latest date", "warning")
            if (latest[key]["as_of"] or date.min) > (as_of or today):
                continue
        latest[key] = dict(row=r.n, part_id=key, supplier_id=p["supplier_id"], on_hand=qty, as_of=as_of or today)
    return list(latest.values()), issues


def validate_releases(rows, mapping, ctx):
    issues, out = [], {}
    for raw in rows:
        r = _Row(raw, mapping, issues)
        p = _part(r, ctx)
        wk = r.get("week_start", parse_date, required=True)
        qty = r.get("quantity", parse_number, required=True)
        if qty is not None and qty < 0:
            r.fail("quantity", "Quantity cannot be negative")
        if not r.ok:
            continue
        monday = wk - timedelta(days=wk.weekday())
        if monday != wk:
            r.warn("week_start", f"{wk} is not a Monday: moved to week of {monday}", "info")
        key = (p["id"], monday)
        if key in out:
            r.warn("week_start", f"Part '{p['number']}' week {monday} appears more than once: keeping the last row")
        out[key] = dict(row=r.n, part_id=p["id"], supplier_id=p["supplier_id"], week_start=monday, quantity=qty)
    return list(out.values()), issues


def validate_receipts(rows, mapping, ctx):
    issues, out = [], {}
    for raw in rows:
        r = _Row(raw, mapping, issues)
        po = r.get("po_number", required=True)
        p = _part(r, ctx)
        sid = _supplier(r, ctx, required=False) if "supplier" in mapping.values() else None
        promised = r.get("promised_date", parse_date, required=True)
        received = r.get("received_date", parse_date)
        ordered = r.get("quantity_ordered", parse_number, required=True)
        got = r.get("quantity_received", parse_number)
        if ordered is not None and ordered <= 0:
            r.fail("quantity_ordered", "Quantity ordered must be greater than 0")
        if got is not None and got < 0:
            r.fail("quantity_received", "Quantity received cannot be negative")
        if not r.ok:
            continue
        if sid and sid != p["supplier_id"]:
            r.warn("supplier", f"Part '{p['number']}' belongs to a different supplier in the parts list: using the one in this row")
        if received is None and got:
            r.warn("received_date", "Quantity received without a received date: treating the line as open")
        if received is not None and got is None:
            got = ordered
            r.warn("quantity_received", "No quantity received: assuming the full quantity arrived", "info")
        key = (po, p["id"])
        if key in out:
            r.warn("po_number", f"PO '{po}' / part '{p['number']}' appears more than once: keeping the last row")
        out[key] = dict(row=r.n, po_number=po, supplier_id=sid or p["supplier_id"], part_id=p["id"], promised_date=promised,
                        received_date=received, quantity_ordered=ordered, quantity_received=got or 0)
    return list(out.values()), issues


VALIDATORS = {"tier1-suppliers": validate_suppliers, "tier1-parts": validate_parts, "tier1-stock": validate_stock,
              "tier1-releases": validate_releases, "tier1-receipts": validate_receipts}
