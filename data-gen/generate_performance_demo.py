"""SAMPLE DATA for the Performance view: goods receipts (26 weeks) and daily risk snapshots (31 days).

Deterministic (fixed random seed). Reads app/src/data/seed/seed.json and writes
  app/src/data/performance-demo.json   (seed mode in the app)
  supabase/demo/performance_demo.sql   (run by hand on a local database for a live demo; reset_demo() clears it)

The patterns follow the demo story: Hules y Mangueras de Orizaba late in the September rains, Polímeros Frontera late
around customs outages, one short Tornillos y Sujetadores delivery on 22 Sep (the track-record miss), the others mostly
on time. Snapshots end on the seed's levels; suppliers with an active risk ease back to calmer scores before it began.
Quantities only: receipts carry no prices (the receipts table has none).
"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "app/src/data/seed/seed.json"
OUT_JSON = ROOT / "app/src/data/performance-demo.json"
OUT_SQL = ROOT / "supabase/demo/performance_demo.sql"

WEEKS = 26
HISTORY_DAYS = 31
SOURCE_REF = "performance-demo"
# Weekday offset of a part's weekly delivery (days before asOf, mod 7), so known events land on their dates.
OFFSETS = {"part-qss-9027-clp": 6, "part-qss-6120-lmb": 4}
# Lines that must match the track-record sample (app/src/data/track-demo.json).
FIXED = {
    ("part-qss-6120-lmb", "2026-09-10"): dict(po="PO-QSS-48211", late=2, short=0),
    ("part-qss-9027-clp", "2026-09-22"): dict(po="PO-QSS-48577", late=0, short=1200),
}


def level_for(score: float) -> str:
    return "red" if score >= 65 else "amber" if score >= 35 else "green"


def receipts_for(seed: dict, as_of: date, rnd: random.Random) -> list[dict]:
    out = []
    for i, p in enumerate(sorted(seed["parts"], key=lambda x: x["id"])):
        sup, usage = p["supplierId"], p["dailyUsage"]
        off = OFFSETS.get(p["id"], i % 7)
        for w in range(WEEKS, -1, -1):
            promised = as_of - timedelta(days=7 * w + off)
            if promised >= as_of:
                continue
            ordered = round(usage * 5)
            late, short = 0, 0
            fixed = FIXED.get((p["id"], promised.isoformat()))
            if fixed:
                late, short = fixed["late"], fixed["short"]
            elif sup == "hmo" and promised >= date(2026, 9, 1):
                late = rnd.choice((0, 2, 3, 3)) if rnd.random() < 0.7 else 0          # rainy season, MEX-150D
            elif sup == "pfl":
                late = rnd.choice((1, 2, 3)) if rnd.random() < (0.5 if promised >= date(2026, 9, 15) else 0.2) else 0
            elif sup in ("pip", "tsr", "rdp") and rnd.random() < 0.08:
                late = 1
            elif rnd.random() < 0.03:
                late = 1
            if not fixed and rnd.random() < 0.025:
                short = round(ordered * rnd.choice((0.05, 0.1, 0.2)))
            received = promised + timedelta(days=late)
            po = fixed["po"] if fixed else f"PO-{p['customerId'].upper()[:3]}-{40000 + len(out)}"
            row = dict(customer_id=p["customerId"], supplier_id=sup, part_id=p["id"], po_number=po,
                       promised_date=promised.isoformat(),
                       received_date=received.isoformat() if received < as_of else None,
                       quantity_ordered=ordered, quantity_received=ordered - short if received < as_of else 0,
                       source="upload", source_ref=SOURCE_REF)
            out.append(row)
    # One line still open: due two days ago, not received (Orizaba rain).
    for r in out:
        if r["part_id"] == "part-qss-6140-clh" and r["promised_date"] >= (as_of - timedelta(days=6)).isoformat():
            r["received_date"], r["quantity_received"] = None, 0
    return out


def history_for(seed: dict, as_of: date, rnd: random.Random) -> list[dict]:
    out = []
    for r in sorted(seed["risks"], key=lambda x: (x["customerId"], x["supplierId"])):
        today = r["score"]
        onset = rnd.randint(4, 14) if today >= 35 else None   # days ago the current risk built up
        calm = max(4, round(today * 0.35))
        for k in range(HISTORY_DAYS - 1, -1, -1):
            d = as_of - timedelta(days=k)
            if k == 0:
                score, level = today, r["level"]
            else:
                if onset is None or k > onset + 3:
                    score = calm + rnd.randint(-2, 3)
                elif k > onset:
                    score = calm + (today - calm) * (onset + 3 - k) / 6
                else:
                    score = today - (today - calm) * 0.5 * k / onset + rnd.randint(-2, 2)
                score = max(0, min(100, round(score)))
                level = level_for(score)
            out.append(dict(customer_id=r["customerId"], supplier_id=r["supplierId"], as_of=d.isoformat(),
                            level=level, score=score, days_to_line_stop=r["daysToLineStop"] if k == 0 else None))
    return out


def camel(row: dict) -> dict:
    return {"".join(w if i == 0 else w.title() for i, w in enumerate(k.split("_"))): v for k, v in row.items()}


def sql_value(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    seed = json.loads(SEED.read_text())
    as_of = date.fromisoformat(seed["asOf"])
    rnd = random.Random(20261005)
    receipts = receipts_for(seed, as_of, rnd)
    history = history_for(seed, as_of, rnd)
    for r in receipts:
        assert not {"price", "unit_cost", "amount", "total"} & set(r), "receipts carry quantities only"

    OUT_JSON.write_text(json.dumps({
        "note": "SAMPLE DATA for the Performance view (seed mode): goods receipts and daily risk snapshots generated by "
                "data-gen/generate_performance_demo.py. Not real deliveries. Live equivalent: supabase/demo/performance_demo.sql.",
        "sample": True,
        "receipts": [{k: v for k, v in camel(r).items() if v is not None} for r in receipts],
        "history": [{k: v for k, v in camel(h).items() if v is not None} for h in history],
    }, ensure_ascii=False, indent=1) + "\n")

    rcols = list(receipts[0])
    hcols = list(history[0])
    lines = [
        "-- SAMPLE DATA for a live demo of the Performance view. Not real deliveries.",
        "-- GENERATED by data-gen/generate_performance_demo.py (same content as app/src/data/performance-demo.json).",
        "-- Run by hand on a local, seeded database:",
        "--   docker exec -i supabase_db_flowtwin-v0 psql -U postgres -d postgres < supabase/demo/performance_demo.sql",
        "-- Safe to run twice (on conflict do nothing). Cleared by reset_demo() (it deletes receipts and risk_history).",
        "begin;", "",
        f"insert into public.receipts ({', '.join(rcols)}) values",
        ",\n".join("  (" + ", ".join(sql_value(r[c]) for c in rcols) + ")" for r in receipts),
        "on conflict do nothing;", "",
        f"insert into public.risk_history ({', '.join(hcols)}) values",
        ",\n".join("  (" + ", ".join(sql_value(h[c]) for c in hcols) + ")" for h in history),
        "on conflict do nothing;", "",
        "commit;",
    ]
    OUT_SQL.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT_JSON.name} ({len(receipts)} receipts, {len(history)} snapshots) and {OUT_SQL.name}")


if __name__ == "__main__":
    main()
