"""Minimal ISOMORPH adapter (spike). Builds an ISOMORPH network from a small dict (see build_input.py) and runs a short
simulation with a scenario: transit slow-down and/or capacity cut on chosen edges, and a demand surge.

MUST be run with ISOMORPH's interpreter:  ../ISOMORPH/.venv/bin/python adapter.py network.json --scenario ... > result.json
It imports the *base* simulator (Supplychaingeo_item50.py) because the v2 file imports a module that is not in the repo.
ISOMORPH is read, never modified: we import it from its folder and re-implement the edge cut here.
"""
import argparse
import contextlib
import io
import json
import math
import os
import random
import sys
import time

ISO = os.environ.get("ISOMORPH_SIM_DIR") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "ISOMORPH", "simulator"))
sys.path.insert(0, ISO)
import numpy as np  # noqa: E402
import Supplychaingeo_item50 as iso  # noqa: E402

UNIT = 100  # 1 ISOMORPH unit = 100 pieces (the simulator allocates unit by unit; real piece counts are too slow)


def tt_days(km):
    return max(1, math.ceil(km * 1.3 / 400))  # same normal-transit rule as the FlowTwin engine


def build(net_in, transit_mult=None, seed=7):
    items = {i["id"]: iso.Item(i["id"], 1.0) for i in net_in["items"]}
    daily = {i["id"]: i["daily_usage"] / UNIT for i in net_in["items"]}
    vol_day = sum(daily.values())
    cover = {i["id"]: i["days_of_cover"] for i in net_in["items"]}
    meta, idx = [], {}
    for n in net_in["nodes"]:
        m = dict(id=n["id"], lat=n["lat"], lon=n["lon"], is_destination=n["role"] == "destination", is_source=n["role"] == "source")
        if n["role"] == "destination":  # customer: on-hand = days of cover, backlog = missed demand (line stop)
            m["inventory"] = {i: int(round(daily[i] * cover[i])) for i in items}
            m["backlog"] = {i: 0 for i in items}
        else:
            lt = n.get("lead_time_days", 2)
            m["inventory"] = {i: int(daily[i] * 12) for i in items}
            m["s_levels"] = {i: int(daily[i] * (lt + 2)) for i in items}
            m["S_levels"] = {i: int(daily[i] * (lt + 8)) for i in items}
            m["lead_time_mean"] = {i: lt for i in items}
        idx[n["id"]] = len(meta)
        meta.append(m)
    adj = [[None] * len(meta) for _ in meta]
    for e in net_in["edges"]:
        tt = tt_days(e["km"]) * (transit_mult or {}).get((e["from_id"], e["to_id"]), 1.0)
        nc = max(1, round(e["trips_per_week"] / 7))
        cvol = math.ceil(vol_day * 1.25 / nc)  # spare capacity of 25%; real truck capacity is not in the schema
        adj[idx[e["from_id"]]][idx[e["to_id"]]] = (tt, float(cvol), nc)
    net = iso.build_network_from_adjacency(meta, adj)
    for n in net_in["nodes"]:
        if n["role"] == "source":
            net.nodes[n["id"]].lead_time_std_frac = float(n.get("lead_time_variability", 0.2))
    return net, items, daily, next(n["id"] for n in net_in["nodes"] if n["role"] == "destination")


def install_cut(net, sim, edges, from_day, days):
    """Zero the capacity of directed edges during [from_day, from_day+days). (v2's `disabled=` kwarg is not in the base Network.)"""
    orig = net.reset_daily_edges
    state = {"day": 0}

    def reset(cap=1.0):
        orig(cap)
        if from_day <= state["day"] < from_day + days:
            for k in edges:
                if k in net.edges:
                    net.edges[k].daily_containers = [0.0] * net.edges[k].num_containers_per_day
    net.reset_daily_edges = reset
    orig_step = sim.step

    def step(day):
        state["day"] = day
        orig_step(day)
    sim.step = step


def run(net_in, days=60, surge=0.0, surge_from=20, surge_days=28, tt_mult=None, cut=None, seed=7):
    net, items, daily, dest = build(net_in, tt_mult, seed)
    rng = np.random.default_rng(seed)
    noise = {i: rng.poisson(daily[i], size=days + 5) for i in items}  # same demand draws in every scenario

    def demand_fn(day):
        f = 1 + surge if surge_from <= day < surge_from + surge_days else 1.0
        return {i: int(round(noise[i][day] * f)) for i in items}

    cover_days = max(i["days_of_cover"] for i in net_in["items"])
    sim = iso.SupplyChainSimulation(net, items, dest, demand_fn, days, seed=seed, pipeline_multiplier=max(1.0, cover_days))
    sim.demand_ema = {i: daily[i] for i in items}
    if cut:
        install_cut(net, sim, [tuple(e) for e in cut["edges"]], cut["from_day"], cut["days"])
    buf = io.StringIO()
    t0 = time.time()
    with contextlib.redirect_stdout(buf):  # the simulator prints progress per day
        dd, ds, svc, di, db, dt = sim.run()
    wall = time.time() - t0

    dd["unfilled"] = dd["new_backlog_today"]
    per_day = dd.groupby("day").agg(demand=("demand", "sum"), served=("served_from_stock", "sum"), unfilled=("unfilled", "sum"))
    stockout = dd[(dd["dest_on_hand_end_before_ship"] == 0) & (dd["dest_backlog_end_before_ship"] > 0)]
    ds = ds[ds["to"] == dest].copy()
    ds["transit"] = ds["arrival_day"] - ds["day"]
    tt = ds.groupby("day")["transit"].apply(list)
    q = lambda a, p: float(np.percentile(a, p)) if len(a) else None  # noqa: E731
    w = slice(surge_from, surge_from + max(surge_days, 14))
    window = per_day.iloc[w]
    return dict(
        wall_seconds=round(wall, 2), days=days,
        service_level_window=round(float(window["served"].sum() / max(window["demand"].sum(), 1)), 4),
        service_level_all=round(float(per_day["served"].sum() / max(per_day["demand"].sum(), 1)), 4),
        stockout_days_per_item={k: int(v) for k, v in stockout.groupby("item")["day"].nunique().items()},
        first_stockout_day=int(stockout["day"].min()) if len(stockout) else None,
        unfilled_units_total=int(per_day["unfilled"].sum()),
        transit_days_into_customer=dict(p10=q(ds["transit"], 10), p50=q(ds["transit"], 50), p90=q(ds["transit"], 90), n=int(len(ds))),
        transit_by_day={int(d): dict(p50=q(v, 50), p90=q(v, 90)) for d, v in tt.items() if d % 7 == 0},
        stdout_lines_swallowed=len(buf.getvalue().splitlines()),
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("network")
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--surge", type=float, default=0.0, help="demand increase, e.g. 0.15")
    ap.add_argument("--slow", type=str, default="", help="edge transit multiplier 'from,to,factor' (e.g. plant,qss,2.6)")
    ap.add_argument("--cut", type=str, default="", help="capacity cut 'from,to,from_day,days'")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    net_in = json.load(open(a.network))
    tt_mult = None
    if a.slow:
        f, t, x = a.slow.split(",")
        tt_mult = {(f, t): float(x)}
    cut = None
    if a.cut:
        f, t, fd, d = a.cut.split(",")
        cut = dict(edges=[(f, t)], from_day=int(fd), days=int(d))
    print(json.dumps(run(net_in, a.days, a.surge, tt_mult=tt_mult, cut=cut, seed=a.seed)))
