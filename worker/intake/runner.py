"""parse-upload job: download, parse, map, validate, write, update the uploads row, refresh profiles, queue a recompute."""
import os
from datetime import date, datetime, timezone
from urllib.parse import quote

import config
from engine.profiles import derive_profile_from_receipts

from .columns import map_columns, norm, slug
from .fileparse import ParseError, parse_file
from .validate import DEFAULT_REQUIREMENTS, VALIDATORS

KINDS = list(VALIDATORS)
SCIAN_DEFAULT = "336300"  # auto parts manufacturing; the real code comes with the supplier's own onboarding


def download(db, storage_path: str) -> bytes:
    """GET {SUPABASE_URL}/storage/v1/object/uploads/<path> with the service role (the db client already carries its headers)."""
    r = db.http.get(f"{config.supabase_url()}/storage/v1/object/uploads/{quote(storage_path, safe='/')}")
    if r.status_code >= 400:
        raise RuntimeError(f"Storage GET {storage_path} -> {r.status_code}: {r.text[:200]}")
    return r.content


def _now():
    return datetime.now(timezone.utc).isoformat()


def _as_of(db) -> date:
    rows = db.select("app_settings", {"id": "eq.1"})
    return date.fromisoformat(str(rows[0]["as_of"])) if rows and rows[0].get("as_of") else date.today()


def load_context(db, customer_id: str, kind: str) -> dict:
    """Lookups the validators need: this customer's suppliers (by id, code or name) and parts (by number)."""
    ctx = {"customer_id": customer_id, "today": date.today(), "suppliers": {}, "parts": {}, "company_ids": set()}
    rels = db.select("relationships", {"customer_id": f"eq.{customer_id}"})
    ids = sorted({r["supplier_id"] for r in rels})
    if ids:
        for c in db.select("companies", {"id": f"in.({','.join(ids)})"}):
            ctx["company_ids"].add(c["id"])
            for k in (c["id"], c["name"], c["id"].removeprefix(f"{customer_id}-")):
                ctx["suppliers"][norm(k)] = c["id"]
    for p in db.select("parts", {"customer_id": f"eq.{customer_id}"}):
        ctx["parts"][norm(p["number"])] = p
    return ctx


# ---------------------------------------------------------------- writers (each returns counts)
def write_suppliers(db, customer_id, recs, _file, ctx=None):
    new = [r for r in recs if not r["existing"]]
    known = [r for r in recs if r["existing"] and r["email"]]
    contacts = {c["id"]: c.get("contact") or {} for c in
                (db.select("companies", {"id": f"in.({','.join(r['id'] for r in known)})"}) if known else [])}
    for r in known:  # merge: a file with only an e-mail keeps the contact's name and role
        db.update("companies", {"id": r["id"]}, {"contact": {**contacts.get(r["id"], {}), "email": r["email"]}})
    db.upsert("companies", [dict(id=r["id"], name=r["name"], city=r["city"], state=r["state"], lat=r["lat"], lon=r["lon"],
                                 kind="supplier", size_band="small", employees=0, scian=SCIAN_DEFAULT, pack_ids=["auto"],
                                 synthetic=False, contact={"email": r["email"]} if r["email"] else None) for r in new], "id")
    db.upsert("relationships", [dict(supplier_id=r["id"], customer_id=customer_id, chain_position="sub", share_of_sales=0,
                                     requirements=DEFAULT_REQUIREMENTS) for r in new], "supplier_id,customer_id")
    return {"companies": len(new), "relationships": len(new)}, [r["id"] for r in recs]


def _cover(on_hand, usage):
    return round(float(on_hand) / float(usage), 1) if usage else 0


def write_parts(db, customer_id, recs, _file, ctx=None):
    existing = ctx["parts"]
    rows = []
    for r in recs:
        old = existing.get(norm(r["number"]))
        on_hand = float(old["on_hand"]) if old else 0
        rows.append(dict(id=old["id"] if old else f"part-{customer_id}-{slug(r['number'])}", number=r["number"], name=r["name"],
                         supplier_id=r["supplier_id"], customer_id=customer_id, unit_cost_mxn=r["unit_cost_mxn"],
                         daily_usage=r["daily_usage"], on_hand=on_hand, days_of_cover=_cover(on_hand, r["daily_usage"]),
                         single_source=r["single_source"], criticality=r["criticality"]))
    db.upsert("parts", rows, "id")
    return {"parts": len(rows)}, sorted({r["supplier_id"] for r in recs})


def write_stock(db, customer_id, recs, _file, ctx=None):
    by_id = {p["id"]: p for p in ctx["parts"].values()}
    rows = []
    for r in recs:
        if r["part_id"] not in by_id:  # validation and context disagree: report the row instead of a KeyError
            ctx.setdefault("write_issues", []).append(dict(row=r.get("row", 0), column="part number", severity="error",
                                                           message=f"Part '{r['part_id']}' is no longer in the parts list: row not saved"))
            continue
        p = dict(by_id[r["part_id"]])
        p["on_hand"] = r["on_hand"]
        p["days_of_cover"] = _cover(r["on_hand"], p["daily_usage"])
        # Optional columns: a blank cell keeps what the part already had (every row carries both keys for the bulk upsert).
        if r.get("in_transit") is not None:
            p["in_transit"] = r["in_transit"]
        if r.get("next_delivery_date") is not None:
            p["next_delivery_date"] = r["next_delivery_date"].isoformat()
        rows.append({k: p.get(k) for k in ("id", "number", "name", "supplier_id", "customer_id", "unit_cost_mxn", "daily_usage",
                                           "on_hand", "days_of_cover", "single_source", "criticality", "in_transit", "next_delivery_date")})
    db.upsert("parts", rows, "id")
    return {"parts_updated": len(rows)}, sorted({r["supplier_id"] for r in rows})


def write_releases(db, customer_id, recs, file_name, ctx=None):
    db.upsert("demand_releases", [dict(customer_id=customer_id, part_id=r["part_id"], week_start=r["week_start"].isoformat(),
                                       quantity=r["quantity"], upload_id=file_name) for r in recs], "customer_id,part_id,week_start")
    return {"demand_releases": len(recs)}, sorted({r["supplier_id"] for r in recs})


def write_receipts(db, customer_id, recs, file_name, ctx=None):
    db.upsert("receipts", [dict(customer_id=customer_id, supplier_id=r["supplier_id"], part_id=r["part_id"], po_number=r["po_number"],
                                promised_date=r["promised_date"].isoformat(),
                                received_date=r["received_date"].isoformat() if r["received_date"] else None,
                                quantity_ordered=r["quantity_ordered"], quantity_received=r["quantity_received"], upload_id=file_name)
                           for r in recs], "customer_id,po_number,part_id")
    return {"receipts": len(recs)}, sorted({r["supplier_id"] for r in recs})


WRITERS = {"tier1-suppliers": write_suppliers, "tier1-parts": write_parts, "tier1-stock": write_stock,
           "tier1-releases": write_releases, "tier1-receipts": write_receipts}


# ---------------------------------------------------------------- profiles
def refresh_profiles(db, customer_id: str, supplier_ids, as_of=None) -> list[str]:
    """Recompute supplier_profiles from the receipts of each supplier (only suppliers that have receipts change)."""
    as_of = as_of or _as_of(db)
    done = []
    for sid in supplier_ids:
        receipts = db.select("receipts", {"customer_id": f"eq.{customer_id}", "supplier_id": f"eq.{sid}"})
        if not receipts:
            continue
        old = (db.select("supplier_profiles", {"customer_id": f"eq.{customer_id}", "supplier_id": f"eq.{sid}"}) or [None])[0]
        ref = float(old["lead_time_mean_days"]) if old and old.get("lead_time_mean_days") and old.get("source") != "receipts" else None
        d = derive_profile_from_receipts(receipts, as_of, ref)
        row = dict(customer_id=customer_id, supplier_id=sid, data_status=d["data_status"],
                   source="mixed" if old and old.get("source") not in (None, "receipts") else "receipts", updated_at=_now())
        for k in ("lead_time_mean_days", "lead_time_variability"):
            if d[k] is not None:
                row[k] = d[k]
        if d["otif_weekly"]:
            row["otif_weekly"] = d["otif_weekly"]
        db.upsert("supplier_profiles", [row], "customer_id,supplier_id")
        done.append(sid)
    return done


# ---------------------------------------------------------------- job
def _save_upload(db, company_id, kind, file_name, rows, status, storage_path, issues, mapping, job_id):
    ext = os.path.splitext(file_name or "")[1].lower()
    db.upsert("uploads", [dict(company_id=company_id, kind=kind, file_name=file_name or "", rows=rows,
                               source="Excel" if ext in (".xlsx", ".xlsm") else "CSV", status=status, uploaded_at=_now(),
                               storage_path=storage_path, issues=issues, mapping=mapping, job_id=job_id)], "company_id,kind")


def check_tenancy(job: dict, company_id, path) -> None:
    """The worker runs with the service role, so a job may only touch its own company's data and files."""
    payload_company = (job.get("payload") or {}).get("company_id")
    if not company_id:
        raise ValueError("parse-upload job has no company_id: refused")
    if payload_company and payload_company != company_id:
        raise ValueError(f"payload company '{payload_company}' differs from the job's company '{company_id}': refused")
    if not path:
        raise ValueError("payload needs storage_path")
    if not path.startswith(f"{company_id}/") or ".." in path.split("/"):
        raise ValueError(f"storage_path '{path}' is not inside the folder of company '{company_id}': refused")


def run_parse_upload(db, job: dict, fetch=None) -> dict:
    """Entry point for jobs of kind 'parse-upload'. payload: {company_id, kind, storage_path, file_name}. Returns a summary dict."""
    payload = job.get("payload") or {}
    company_id = job.get("company_id")  # set under RLS by the user who queued the job; the payload is only a hint
    kind, path, file_name = payload.get("kind"), payload.get("storage_path"), payload.get("file_name") or ""
    if kind not in VALIDATORS:
        raise ValueError(f"Unknown upload kind '{kind}' (expected one of {', '.join(KINDS)})")
    check_tenancy(job, company_id, path)
    if not db.select("companies", {"id": f"eq.{company_id}", "kind": "eq.customer"}):
        raise ValueError(f"Company {company_id} is not a key customer")
    job_id = job.get("id")
    data = (fetch or download)(db, path)
    try:
        headers, rows = parse_file(data, file_name or path)
    except ParseError as e:
        issues = [dict(row=0, column="", message=str(e), severity="error")]
        _save_upload(db, company_id, kind, file_name, 0, "needs-input", path, issues, {}, job_id)
        return {"company_id": company_id, "kind": kind, "status": "needs-input", "rows": 0, "errors": 1}
    mapping, issues = map_columns(kind, headers)
    ctx = load_context(db, company_id, kind)
    records = []
    if not any(i["severity"] == "error" for i in issues):  # required column missing: nothing to validate
        records, row_issues = VALIDATORS[kind](rows, mapping, ctx)
        issues += row_issues
    written, affected, profiles, saved = {}, [], [], 0
    if records:
        w = WRITERS[kind]
        written, affected = w(db, company_id, records, file_name or path, ctx=ctx)
        skipped = ctx.get("write_issues", [])  # rows a writer could not save
        issues += skipped
        saved = len(records) - len(skipped)
    errors = sum(1 for i in issues if i["severity"] == "error")
    status = "needs-input" if errors else "uploaded"
    _save_upload(db, company_id, kind, file_name, saved, status, path, issues, mapping, job_id)
    queued = None
    if saved:
        profiles = refresh_profiles(db, company_id, affected)
        db.insert("jobs", [{"kind": "recompute-risk", "company_id": company_id, "payload": {"reason": "parse-upload", "kind": kind}}])
        queued = "recompute-risk"
    return {"company_id": company_id, "kind": kind, "status": status, "rows": saved, "input_rows": len(rows),
            "errors": errors, "warnings": sum(1 for i in issues if i["severity"] == "warning"), "written": written,
            "profiles_updated": profiles, "queued": queued}
