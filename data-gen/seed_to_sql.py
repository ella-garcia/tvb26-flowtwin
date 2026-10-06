#!/usr/bin/env python3
"""Convert app/src/data/seed/seed.json into supabase/seed.sql (stdlib only).

Run: python3 data-gen/seed_to_sql.py
Column kinds: s = scalar, j = jsonb (kept as camelCase JSON), a = text[].
Keys absent from a seed row become DEFAULT. Seed keys that are not columns are dropped; SEED_KEY maps the few that differ.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "app/src/data/seed/seed.json"
OUT = ROOT / "supabase/seed.sql"
PROFILES = ROOT / "worker/data/supplier_profiles.json"
sys.path.insert(0, str(ROOT / "worker"))
from engine.otif import otif_series  # same synthetic 12-week OTIF generator the engine uses
from naming import camel

# (seed key, table, columns). Columns are snake_case; kinds default to scalar.
J, A = "j", "a"
TABLES = [
    ("companies", "companies", {"pack_ids": A, "contact": J}),
    ("relationships", "relationships", {"requirements": J}),
    ("signals", "signals", {"highways": A}),
    ("emissionFactors", "emission_factors", {}),
    ("sites", "sites", {}),
    ("partners", "partners", {}),
    ("lanes", "lanes", {}),
    ("machines", "machines", {}),
    ("certifications", "certifications", {}),
    ("kpis", "kpis", {}),
    ("energy", "energy", {}),
    ("materials", "materials", {}),
    ("shipments", "shipments", {}),
    ("twins", "twins", {"counts": J, "accuracy": J, "days": J}),
    ("uploads", "uploads", {}),
    ("programs", "vehicle_programs", {}),
    ("parts", "parts", {"program_ids": A}),
    ("risks", "risks", {"drivers": J, "flex": J, "otif_trend": J, "projection": J, "part_stop_days": J, "legs": J, "outlook": J, "scenarios": J}),
    ("alerts", "alerts", {"part_ids": A, "actions": J, "supplier_response": J}),
    ("invites", "invites", {}),
    ("requests", "requests", {"items": A}),
    ("shares", "shares", {"items": A, "scorecard": J, "carbon": J}),
]
# Columns each table accepts (excluding generated identity ids). Anything else in the seed is ignored.
COLUMNS = {
    "companies": "id name city state lat lon kind size_band employees scian pack_ids synthetic contact",
    "relationships": "supplier_id customer_id chain_position share_of_sales requirements",
    "signals": "id kind title description state lat lon radius_km highways starts_at ends_at severity transit_multiplier source provenance short_label",
    "emission_factors": "id version name value unit scope source year",
    "sites": "id company_id name type city lat lon pallet_positions rented_positions",
    "partners": "id company_id name role city lat lon linked_company_id material lead_time_days lead_time_variability",
    "lanes": "id company_id from_id to_id direction highway km trips_per_week fill_rate theft_risk night_share cost_per_trip_mxn",
    "machines": "id company_id name capacity_tonnes shifts_per_week utilization",
    "certifications": "company_id name valid_until",
    "kpis": "company_id kpi_id customer_id value provenance as_of",
    "energy": "company_id month electricity_kwh diesel_litres natural_gas_m3 source",
    "materials": "company_id material tonnes year source",
    "shipments": "company_id customer_id year tonnes",
    "twins": "company_id synced_through built_at counts accuracy overall_accuracy days",
    "uploads": "company_id kind file_name rows source status uploaded_at storage_path",
    "parts": "id number name supplier_id customer_id unit_cost_mxn daily_usage on_hand days_of_cover single_source criticality in_transit supplier_fg_on_hand next_delivery_date program_ids",
    "vehicle_programs": "id customer_id oem model oem_plant daily_vehicles",
    "risks": "customer_id supplier_id level score normal_transit_days expected_transit_days worst_case_transit_days min_cover_days days_to_line_stop part_stop_days legs line_stop_exposure_eur drivers flex otif_trend projection outlook scenarios data_status updated_at",
    "alerts": "id customer_id supplier_id part_ids signal_id level title message created_at expected_shortfall_date line_stop_exposure_eur status actions chosen_action_id supplier_response",
    "invites": "id customer_id supplier_id supplier_name contact_email sent_at status plan",
    "requests": "id from_company_id to_company_id items fiscal_year sent_at due_date status note",
    "shares": "id supplier_id customer_id request_id items approved_by approved_at version revoked scorecard carbon",
}

# column -> seed key where it is not just the camelCase of the column
SEED_KEY = {"short_label": "short"}

def seed_key(c):
    return SEED_KEY.get(c) or camel(c)

# Tables reset_demo() restores from demo_snapshot (plus supplier_profiles, built below).
SNAPSHOT_TABLES = ("companies", "relationships", "vehicle_programs", "parts", "risks", "alerts", "invites")

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

def lit(v, kind):
    if v is None:
        return "NULL"
    if kind == J:
        return q(json.dumps(v, ensure_ascii=False)) + "::jsonb"
    if kind == A:
        return "ARRAY[" + ",".join(q(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return q(v)

def main():
    seed = json.loads(SEED.read_text())
    out = ["-- GENERATED by data-gen/seed_to_sql.py from app/src/data/seed/seed.json. Do not edit.",
           "begin;", ""]
    snapshots = {}
    for key, table, kinds in TABLES:
        rows = seed.get(key) or []
        if not rows:
            continue
        cols = [c for c in COLUMNS[table].split() if any(seed_key(c) in r for r in rows)]
        out.append(f"-- {table} ({len(rows)})")
        out.append(f"insert into public.{table} ({', '.join(cols)}) values")
        vals = []
        for r in rows:
            vals.append("  (" + ", ".join(
                lit(r[seed_key(c)], kinds.get(c, "s")) if seed_key(c) in r else "DEFAULT" for c in cols) + ")")
        out.append(",\n".join(vals) + ";\n")
        if table in SNAPSHOT_TABLES:
            snapshots[table] = [{c: r[seed_key(c)] for c in COLUMNS[table].split() if seed_key(c) in r} for r in rows]
    # supplier_profiles: one row per (customer, supplier) relationship, from worker/data/supplier_profiles.json
    prof = json.loads(PROFILES.read_text())
    pcols = ("customer_id supplier_id highways lead_time_variability utilization capacity_ceiling finished_goods_days "
             "bottleneck otif_weekly data_status source route").split()
    prows, psnap = [], []
    for rel in seed.get("relationships", []):
        p = prof.get(rel["supplierId"])
        if not p:
            continue
        prows.append("  (" + ", ".join([
            lit(rel["customerId"], "s"), lit(rel["supplierId"], "s"), lit(p["highways"], A), lit(p["lead_time_variability"], "s"),
            lit(p["utilization"], "s"), lit(p["ceiling"], "s"), lit(p["fg_days"], "s"), lit(p["bottleneck"], "s"),
            lit(otif_series(rel["supplierId"], p["otif"]), J), lit(p["data_status"], "s"), lit("seed", "s"), lit(p.get("route"), J)]) + ")")
        psnap.append(dict(zip(pcols, [rel["customerId"], rel["supplierId"], p["highways"], p["lead_time_variability"], p["utilization"],
                                      p["ceiling"], p["fg_days"], p["bottleneck"], otif_series(rel["supplierId"], p["otif"]),
                                      p["data_status"], "seed", p.get("route")])))
    snapshots["supplier_profiles"] = psnap
    out.append(f"-- supplier_profiles ({len(prows)})")
    out.append(f"insert into public.supplier_profiles ({', '.join(pcols)}) values")
    out.append(",\n".join(prows) + ";\n")
    s = seed.get("settings", {})
    out.append(
        "update public.app_settings set "
        f"line_stop_cost_eur_per_minute = {s['lineStopCostEurPerMinute']}, "
        f"contract_demand_swing = {s['contractDemandSwing']}, "
        f"line_hours_per_day = {s['lineHoursPerDay']}, "
        f"as_of = {q(seed['asOf'])}::date where id = 1;\n")
    out.append("-- reset_demo() restores these (table column shape, snake_case)")
    out.append("insert into public.demo_snapshot (name, rows) values")
    out.append(",\n".join(f"  ({q(n)}, {q(json.dumps(rows, ensure_ascii=False))}::jsonb)"
                          for n, rows in snapshots.items()) +
               "\non conflict (name) do update set rows = excluded.rows;\n")
    out.append("commit;")
    OUT.write_text("\n".join(out) + "\n")
    print(f"wrote {OUT}")

if __name__ == "__main__":
    main()
