"""Build the small network dict the adapter consumes, from one supplier's rows (DB/seed shape).

Run with any python:  python build_input.py [supplier_id] [customer_id] > network.json
Reads app/src/data/seed/seed.json (same rows the DB holds: sites, partners, lanes, parts).
"""
import json
import math
import os
import sys

SEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "app", "src", "data", "seed", "seed.json")


def build(seed, supplier_id="edl", customer_id="qss"):
    sites = [s for s in seed["sites"] if s["companyId"] == supplier_id]
    partners = {p["id"]: p for p in seed["partners"] if p["companyId"] == supplier_id}
    lanes = [l for l in seed["lanes"] if l["companyId"] == supplier_id]
    parts = [p for p in seed["parts"] if p["supplierId"] == supplier_id and p["customerId"] == customer_id]
    plant = next(s for s in sites if s["type"] == "plant")
    cust_partner = next(p for p in partners.values() if p.get("linkedCompanyId") == customer_id)
    nodes = [dict(id=plant["id"], role="plant", lat=plant["lat"], lon=plant["lon"])]
    for p in partners.values():
        if p["role"] == "supplier":
            nodes.append(dict(id=p["id"], role="source", lat=p["lat"], lon=p["lon"],
                              lead_time_days=p["leadTimeDays"], lead_time_variability=p["leadTimeVariability"]))
    nodes.append(dict(id=cust_partner["id"], role="destination", lat=cust_partner["lat"], lon=cust_partner["lon"]))
    edges = []
    for l in lanes:
        if l["direction"] == "internal" or l["toId"] not in {n["id"] for n in nodes} or l["fromId"] not in {n["id"] for n in nodes}:
            continue  # warehouse lane and the other customers (ISOMORPH has a single destination) are dropped
        edges.append(dict(from_id=l["fromId"], to_id=l["toId"], km=l["km"], trips_per_week=l["tripsPerWeek"], fill_rate=l["fillRate"]))
    items = [dict(id=p["number"], daily_usage=p["dailyUsage"], days_of_cover=p["daysOfCover"], criticality=p["criticality"]) for p in parts]
    return dict(supplier_id=supplier_id, customer_id=customer_id, nodes=nodes, edges=edges, items=items)


if __name__ == "__main__":
    with open(SEED, encoding="utf-8") as f:
        seed = json.load(f)
    json.dump(build(seed, *(sys.argv[1:3])), sys.stdout, indent=1)
