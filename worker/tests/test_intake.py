"""Intake: column mapping (English + Spanish), validation, file parsing, and the parse-upload job against an in-memory DB."""
import io
from datetime import date

import pytest

from intake import run_parse_upload
from intake.columns import map_columns, norm, parse_date, parse_number
from intake.fileparse import parse_file
from intake.validate import VALIDATORS

CTX = {"customer_id": "qss", "today": date(2026, 10, 5), "company_ids": {"edl"},
       "suppliers": {"edl": "edl", "estampados del laja": "edl", "hmo": "hmo"},
       "parts": {norm("QSS-1"): {"id": "p1", "number": "QSS-1", "supplier_id": "edl", "daily_usage": 10, "on_hand": 0},
                 norm("QSS-2"): {"id": "p2", "number": "QSS-2", "supplier_id": "hmo", "daily_usage": 5, "on_hand": 0}}}


def run_kind(kind, csv_text, ctx=CTX):
    headers, rows = parse_file(csv_text.encode("utf-8"), "x.csv")
    mapping, issues = map_columns(kind, headers)
    recs, row_issues = VALIDATORS[kind](rows, mapping, ctx)
    return mapping, recs, issues + row_issues


# ---------------------------------------------------------------- mapping
def test_english_headers_map():
    m, _, issues = run_kind("tier1-receipts", "PO number,supplier code,part number,promised date,received date,quantity ordered,quantity received\n"
                                                "PO1,edl,QSS-1,2026-09-01,2026-09-02,100,100\n")
    assert set(m.values()) == {"po_number", "supplier", "number", "promised_date", "received_date", "quantity_ordered", "quantity_received"}
    assert not [i for i in issues if i["severity"] == "error"]


def test_spanish_erp_headers_map_accent_and_case_insensitive():
    m, recs, issues = run_kind("tier1-receipts", "ORDEN DE COMPRA;Proveedor;Número de parte;Fecha compromiso;Fecha recepción;Cantidad pedida;Cantidad recibida\n"
                                                  "OC-9;EDL;qss-1;01/09/2026;02/09/2026;1,000;800\n")
    assert m["Número de parte"] == "number" and m["Fecha recepción"] == "received_date" and m["Cantidad recibida"] == "quantity_received"
    assert len(recs) == 1
    r = recs[0]
    assert r["promised_date"] == date(2026, 9, 1) and r["received_date"] == date(2026, 9, 2)  # day-first dates
    assert r["quantity_ordered"] == 1000 and r["quantity_received"] == 800 and r["supplier_id"] == "edl"


def test_spanish_stock_and_parts_headers():
    m, recs, _ = run_kind("tier1-stock", "Número de parte,Existencia,Fecha de corte\nQSS-1,500,05/10/2026\n")
    assert m == {"Número de parte": "number", "Existencia": "on_hand", "Fecha de corte": "as_of"} and recs[0]["on_hand"] == 500
    m, recs, _ = run_kind("tier1-parts", "No. de parte,Descripción,Proveedor,Costo unitario,Consumo diario,Fuente única,Criticidad\n"
                                          "QSS-9,Soporte,edl,\"$1,250.50\",100,Sí,paro de línea\n")
    assert recs[0]["single_source"] is True and recs[0]["criticality"] == "line-stopper" and recs[0]["unit_cost_mxn"] == 1250.5


def test_proveedor_is_the_name_in_a_suppliers_file():
    m, _ = map_columns("tier1-suppliers", ["Proveedor", "Ciudad", "Estado", "Correo", "Código proveedor"])
    assert m["Proveedor"] == "name" and m["Código proveedor"] == "code" and m["Correo"] == "email"


def test_parenthetical_in_header_is_ignored():
    m, _ = map_columns("tier1-parts", ["part number", "name", "supplier code", "unit cost MXN", "daily usage", "single source (yes/no)"])
    assert m["single source (yes/no)"] == "single_source"


def test_missing_required_column_is_an_error():
    _, issues = map_columns("tier1-stock", ["part number"])
    assert any(i["severity"] == "error" and i["column"] == "on_hand" for i in issues)


# ---------------------------------------------------------------- values
def test_number_and_date_parsers():
    assert parse_number("1.234,50") == 1234.5 and parse_number("1,234.50") == 1234.5 and parse_number("12,5") == 12.5
    assert parse_number("1,000") == 1000
    assert parse_date("2026-09-01") == date(2026, 9, 1) and parse_date("1/9/26") == date(2026, 9, 1)
    assert parse_date(46000) == date(2025, 12, 9)  # Excel serial
    with pytest.raises(ValueError):
        parse_date("32/13/2026")
    with pytest.raises(ValueError):
        parse_number("abc")


# ---------------------------------------------------------------- validation
def test_receipts_validation_issues():
    csv = ("PO number,supplier code,part number,promised date,received date,quantity ordered,quantity received\n"
           "PO1,edl,QSS-1,2026-09-01,2026-09-02,100,100\n"        # ok
           "PO2,nope,QSS-1,2026-09-01,,100,0\n"                   # unknown supplier
           "PO3,edl,QSS-X,2026-09-01,,100,0\n"                    # unknown part
           "PO4,edl,QSS-1,31/02/2026,,100,0\n"                    # bad date
           "PO5,edl,QSS-1,2026-09-01,,abc,0\n"                    # bad number
           ",edl,QSS-1,2026-09-01,,10,0\n")                       # missing PO
    _, recs, issues = run_kind("tier1-receipts", csv)
    assert [r["po_number"] for r in recs] == ["PO1"]
    errs = {(i["row"], i["column"]) for i in issues if i["severity"] == "error"}
    assert errs == {(3, "supplier code"), (4, "part number"), (5, "promised date"), (6, "quantity ordered"), (7, "PO number")}
    assert all(set(i) == {"row", "column", "message", "severity"} for i in issues)


def test_suppliers_unknown_city_left_out_and_known_geocoded():
    _, recs, issues = run_kind("tier1-suppliers", "name,city,state,email,code\nA,Celaya,,a@x.mx,A1\nB,Atlantis,Sonora,b@x.mx,B1\nC,Querétaro,Qro.,not-an-email,\n")
    assert [r["id"] for r in recs] == ["qss-a1", "qss-c"] and recs[0]["state"] == "Guanajuato" and recs[1]["state"] == "Querétaro"
    assert recs[0]["lat"] == 20.52 and recs[1]["email"] is None
    assert any(i["row"] == 3 and i["severity"] == "error" and "cannot be placed" in i["message"] for i in issues)
    assert any(i["row"] == 4 and i["column"] == "email" and i["severity"] == "warning" for i in issues)


def test_parts_validation_and_duplicates():
    _, recs, issues = run_kind("tier1-parts", "part number,name,supplier code,unit cost MXN,daily usage,single source,criticality\n"
                                               "N1,One,edl,10,0,no,high\nN2,Two,edl,10,5,maybe,high\nN3,Three,edl,-1,5,no,normal\n"
                                               "N4,Four,edl,5,5,no,normal\nN4,Dup,edl,5,5,no,normal\n")
    assert [r["number"] for r in recs] == ["N4"]
    assert len([i for i in issues if i["severity"] == "error"]) == 4


def test_releases_normalise_to_monday_and_dedupe():
    _, recs, issues = run_kind("tier1-releases", "part number,week start,quantity\nQSS-1,2026-10-07,100\nQSS-1,2026-10-05,200\n")
    assert len(recs) == 1 and recs[0]["week_start"] == date(2026, 10, 5) and recs[0]["quantity"] == 200
    assert any(i["severity"] == "warning" for i in issues)


def test_xlsx_roundtrip():
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.append(["Número de parte", "Existencia", "Fecha"])
    ws.append(["QSS-1", 120, date(2026, 10, 1)])
    buf = io.BytesIO()
    wb.save(buf)
    headers, rows = parse_file(buf.getvalue(), "stock.xlsx")
    m, _ = map_columns("tier1-stock", headers)
    recs, issues = VALIDATORS["tier1-stock"](rows, m, CTX)
    assert recs[0]["on_hand"] == 120 and recs[0]["as_of"] == date(2026, 10, 1) and not issues


# ---------------------------------------------------------------- job
class MemDB:
    def __init__(self, tables):
        self.t = {k: [dict(r) for r in v] for k, v in tables.items()}
        self.inserted = []

    def select(self, table, params=None):
        rows = self.t.get(table, [])
        for k, v in (params or {}).items():
            if k in ("select", "order", "limit"):
                continue
            if v.startswith("eq."):
                rows = [r for r in rows if str(r.get(k)) == v[3:]]
            elif v.startswith("in.("):
                rows = [r for r in rows if r.get(k) in v[4:-1].split(",")]
        return [dict(r) for r in rows]

    def upsert(self, table, rows, on_conflict):
        keys = on_conflict.split(",")
        tbl = self.t.setdefault(table, [])
        for row in rows:
            hit = next((r for r in tbl if all(r.get(k) == row.get(k) for k in keys)), None)
            if hit:
                hit.update(row)
            else:
                tbl.append(dict(row))

    def insert(self, table, rows):
        self.inserted.append((table, rows))
        return rows

    def update(self, table, match, values):
        for r in self.t.get(table, []):
            if all(str(r.get(k)) == str(v).removeprefix("eq.") for k, v in match.items()):
                r.update(values)
        return [values]


def base_db():
    return MemDB(dict(
        app_settings=[dict(id=1, as_of="2026-10-05")],
        companies=[dict(id="qss", name="QSS", kind="customer"), dict(id="edl", name="Estampados del Laja", kind="supplier"),
                   dict(id="hmo", name="Hules de Orizaba", kind="supplier")],
        relationships=[dict(supplier_id="edl", customer_id="qss"), dict(supplier_id="hmo", customer_id="qss")],
        parts=[dict(id="part-qss-1", number="QSS-1", name="One", supplier_id="edl", customer_id="qss", unit_cost_mxn=1, daily_usage=10,
                    on_hand=0, days_of_cover=0, single_source=False, criticality="normal")]))


def job(kind, path="qss/x/1-file.csv", name="file.csv"):
    return dict(id=7, kind="parse-upload", company_id="qss", payload=dict(company_id="qss", kind=kind, storage_path=path, file_name=name))


def test_job_receipts_writes_rows_profile_upload_and_queues_recompute():
    db = base_db()
    csv = ("PO number,supplier code,part number,promised date,received date,quantity ordered,quantity received\n"
           "PO1,edl,QSS-1,2026-09-14,2026-09-14,100,100\nPO2,edl,QSS-1,2026-09-21,2026-09-24,100,80\nPO3,edl,QSS-1,2026-09-28,2026-09-28,100,100\n"
           "PO4,zzz,QSS-1,2026-09-28,2026-09-28,100,100\n")
    res = run_parse_upload(db, job("tier1-receipts"), fetch=lambda d, p: csv.encode())
    assert res["status"] == "needs-input" and res["rows"] == 3 and res["errors"] == 1 and res["queued"] == "recompute-risk"
    assert len(db.t["receipts"]) == 3 and db.t["receipts"][0]["upload_id"] == "file.csv"
    up = db.t["uploads"][0]
    assert up["status"] == "needs-input" and up["rows"] == 3 and up["job_id"] == 7 and up["storage_path"] == "qss/x/1-file.csv"
    assert up["issues"][0]["row"] == 5 and up["mapping"]["supplier code"] == "supplier"
    prof = db.t["supplier_profiles"][0]
    assert prof["supplier_id"] == "edl" and prof["data_status"] == "connected" and len(prof["otif_weekly"]) == 12 and prof["source"] == "receipts"
    assert db.inserted[0][1][0]["kind"] == "recompute-risk" and db.inserted[0][1][0]["company_id"] == "qss"
    # re-uploading the same file is idempotent
    run_parse_upload(db, job("tier1-receipts"), fetch=lambda d, p: csv.encode())
    assert len(db.t["receipts"]) == 3


def test_job_clean_suppliers_then_parts_then_stock():
    db = base_db()
    run_parse_upload(db, job("tier1-suppliers"), fetch=lambda d, p: b"supplier name,city,state,contact email,supplier code\nNuevo SA,Saltillo,Coahuila,n@x.mx,NV-1\n")
    new = [c for c in db.t["companies"] if c["id"] == "qss-nv-1"][0]
    assert new["kind"] == "supplier" and new["synthetic"] is False and new["lat"] == 25.42
    assert any(r["supplier_id"] == "qss-nv-1" and r["chain_position"] == "sub" for r in db.t["relationships"])
    assert db.t["uploads"][0]["status"] == "uploaded"
    res = run_parse_upload(db, job("tier1-parts"), fetch=lambda d, p: b"part number,name,supplier code,unit cost MXN,daily usage\nQSS-1,One,NV-1,2,20\nQSS-NEW,New,edl,3,30\n")
    assert res["status"] == "uploaded"
    parts = {p["number"]: p for p in db.t["parts"]}
    assert parts["QSS-1"]["supplier_id"] == "qss-nv-1" and parts["QSS-NEW"]["id"] == "part-qss-qss-new" and parts["QSS-NEW"]["on_hand"] == 0
    run_parse_upload(db, job("tier1-stock"), fetch=lambda d, p: b"part number,on hand units\nQSS-NEW,90\n")
    p = {p["number"]: p for p in db.t["parts"]}["QSS-NEW"]
    assert p["on_hand"] == 90 and p["days_of_cover"] == 3.0


def test_stock_upload_reads_in_transit_and_next_delivery_and_keeps_them_when_blank():
    m, recs, _ = run_kind("tier1-stock", "Número de parte,Existencia,En tránsito,Próxima entrega\nQSS-1,500,120,08/10/2026\n")
    assert m["En tránsito"] == "in_transit" and m["Próxima entrega"] == "next_delivery_date"
    assert recs[0]["in_transit"] == 120 and recs[0]["next_delivery_date"].isoformat() == "2026-10-08"
    db = base_db()
    run_parse_upload(db, job("tier1-stock"), fetch=lambda d, p: b"part number,on hand units,in transit,ETA\nQSS-1,40,20,2026-10-08\n")
    p = {p["number"]: p for p in db.t["parts"]}["QSS-1"]
    assert p["in_transit"] == 20 and p["next_delivery_date"] == "2026-10-08"
    run_parse_upload(db, job("tier1-stock"), fetch=lambda d, p: b"part number,on hand units\nQSS-1,35\n")
    p = {p["number"]: p for p in db.t["parts"]}["QSS-1"]
    assert p["on_hand"] == 35 and p["in_transit"] == 20 and p["next_delivery_date"] == "2026-10-08"


def test_job_missing_required_column_writes_nothing():
    db = base_db()
    res = run_parse_upload(db, job("tier1-stock"), fetch=lambda d, p: b"part number\nQSS-1\n")
    assert res["status"] == "needs-input" and res["rows"] == 0 and res["queued"] is None and not db.inserted
    assert db.t["uploads"][0]["status"] == "needs-input"


def test_job_unreadable_file_is_needs_input():
    db = base_db()
    res = run_parse_upload(db, job("tier1-parts", name="a.xlsx"), fetch=lambda d, p: b"not a workbook")
    assert res["status"] == "needs-input" and db.t["uploads"][0]["issues"][0]["severity"] == "error"


def test_job_rejects_unknown_kind_and_non_customer():
    with pytest.raises(ValueError):
        run_parse_upload(base_db(), job("tier1-nope"), fetch=lambda d, p: b"")
    j = job("tier1-parts", path="edl/x/1-file.csv")
    j["company_id"] = j["payload"]["company_id"] = "edl"
    with pytest.raises(ValueError, match="not a key customer"):
        run_parse_upload(base_db(), j, fetch=lambda d, p: b"")


def _refused(j):
    """Run a job whose tenancy check must fail before any file is read or row is written."""
    db, fetched = base_db(), []
    with pytest.raises(ValueError, match="refused"):
        run_parse_upload(db, j, fetch=lambda d, p: fetched.append(p) or b"part number,on hand units\nQSS-1,1\n")
    assert not fetched and "uploads" not in db.t and db.t["parts"][0]["on_hand"] == 0 and not db.inserted


def test_job_refuses_payload_company_other_than_job_company():
    j = job("tier1-stock", path="slp-interiors/x/1-file.csv")
    j["payload"]["company_id"] = "slp-interiors"  # job row says qss (checked by RLS), payload points elsewhere
    _refused(j)


def test_job_refuses_missing_job_company():
    j = job("tier1-stock")
    j["company_id"] = None  # the payload alone is never trusted
    _refused(j)


def test_job_refuses_storage_path_outside_company_folder():
    _refused(job("tier1-stock", path="slp-interiors/tier1-stock/1-file.csv"))
    _refused(job("tier1-stock", path="qss-other/x/1-file.csv"))
    _refused(job("tier1-stock", path="qss/../slp-interiors/x.csv"))


def test_job_accepts_payload_without_company():
    j = job("tier1-stock")
    del j["payload"]["company_id"]
    assert run_parse_upload(base_db(), j, fetch=lambda d, p: b"part number,on hand units\nQSS-1,5\n")["rows"] == 1


def test_suppliers_upload_merges_email_into_existing_contact():
    db = base_db()
    db.t["companies"][1]["contact"] = {"name": "Roberto Laja", "role": "Owner", "email": "old@edl.mx"}
    run_parse_upload(db, job("tier1-suppliers"),
                     fetch=lambda d, p: b"supplier name,city,state,contact email,supplier code\nEstampados del Laja,Celaya,Guanajuato,new@edl.mx,edl\n")
    edl = [c for c in db.t["companies"] if c["id"] == "edl"][0]
    assert edl["contact"] == {"name": "Roberto Laja", "role": "Owner", "email": "new@edl.mx"}


def test_write_stock_skips_part_missing_from_context_with_an_issue():
    from intake.runner import write_stock
    db, ctx = base_db(), {"parts": {norm("QSS-1"): base_db().t["parts"][0]}}
    recs = [dict(row=2, part_id="part-qss-1", supplier_id="edl", on_hand=7), dict(row=3, part_id="part-gone", supplier_id="hmo", on_hand=1)]
    written, affected = write_stock(db, "qss", recs, "f.csv", ctx=ctx)
    assert written == {"parts_updated": 1} and affected == ["edl"] and db.t["parts"][0]["on_hand"] == 7
    assert ctx["write_issues"] == [dict(row=3, column="part number", severity="error",
                                        message="Part 'part-gone' is no longer in the parts list: row not saved")]


def test_job_reports_rows_a_writer_skipped(monkeypatch):
    real = VALIDATORS["tier1-stock"]

    def drifting(rows, mapping, ctx):  # validation sees QSS-1, then the writer's lookup no longer has it
        out = real(rows, mapping, ctx)
        ctx["parts"].pop(norm("QSS-1"))
        return out
    monkeypatch.setitem(VALIDATORS, "tier1-stock", drifting)
    db = base_db()
    res = run_parse_upload(db, job("tier1-stock"), fetch=lambda d, p: b"part number,on hand units\nQSS-1,5\n")
    assert res["status"] == "needs-input" and res["rows"] == 0 and res["errors"] == 1 and res["queued"] is None
    assert db.t["uploads"][0]["rows"] == 0 and "no longer in the parts list" in db.t["uploads"][0]["issues"][-1]["message"]


# ---------------------------------------------------------------- ingest_rows (non-file sources: EDI, ERP, CFDI)
def test_ingest_rows_takes_field_named_rows_and_tags_provenance():
    from intake import ingest_rows
    db = base_db()
    rows = [dict(po_number="PO9", supplier="edl", number="QSS-1", promised_date="2026-09-14", received_date="2026-09-15",
                 quantity_ordered=100, quantity_received=100)]
    res = ingest_rows(db, "qss", "tier1-receipts", rows, source="edi", source_ref="ISA-000123", file_name="edi-856", label="EDI")
    assert res["status"] == "uploaded" and res["rows"] == 1 and res["source"] == "edi"
    r = db.t["receipts"][0]
    assert r["source"] == "edi" and r["source_ref"] == "ISA-000123" and r["upload_id"] == "edi-856"
    assert db.t["uploads"][0]["source"] == "EDI"
    assert db.inserted[0][1][0]["payload"]["reason"] == "intake-edi"


def test_ingest_rows_stock_records_stock_source_and_uploads_keep_upload_provenance():
    from intake import ingest_rows
    db = base_db()
    ingest_rows(db, "qss", "tier1-stock", [dict(number="QSS-1", on_hand=55)], source="erp", source_ref="sync-42", label="ERP")
    p = db.t["parts"][0]
    assert p["on_hand"] == 55 and p["stock_source"] == "erp" and p["stock_source_ref"] == "sync-42"
    run_parse_upload(db, job("tier1-stock"), fetch=lambda d, p: b"part number,on hand units\nQSS-1,60\n")
    p = db.t["parts"][0]
    assert p["on_hand"] == 60 and p["stock_source"] == "upload" and p["stock_source_ref"] == "file.csv"
    assert db.t["uploads"][0]["source"] == "CSV"


def test_ingest_rows_rejects_unknown_kind():
    from intake import ingest_rows
    with pytest.raises(ValueError):
        ingest_rows(base_db(), "qss", "tier1-nope", [], source="edi")
