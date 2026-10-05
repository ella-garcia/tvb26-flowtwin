"""Run the adapter in ISOMORPH's venv for a set of scenarios; write out/results.json. Usage: python run_spike.py"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.environ.get("ISOMORPH_PYTHON") or os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "ISOMORPH", ".venv", "bin", "python"))
sys.path.insert(0, HERE)
import build_input  # noqa: E402

SEED = build_input.SEED
SCENARIOS = {
    "baseline": [],
    "slow_transit_x2.6": ["--slow", "edl-plant,edl-p-qss,2.6"],
    "edge_cut_4d": ["--cut", "edl-plant,edl-p-qss,20,4"],
    "surge_15": ["--surge", "0.15"],
    "slow_x2.6_plus_surge": ["--slow", "edl-plant,edl-p-qss,2.6", "--surge", "0.15"],
}

if __name__ == "__main__":
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    net = os.path.join(HERE, "out", "network.json")
    with open(SEED, encoding="utf-8") as f:
        json.dump(build_input.build(json.load(f), "edl", "qss"), open(net, "w"))
    results = {}
    for name, args in SCENARIOS.items():
        t0 = time.time()
        p = subprocess.run([PY, os.path.join(HERE, "adapter.py"), net, "--days", "60", *args], capture_output=True, text=True)
        if p.returncode:
            results[name] = dict(error=p.stderr[-800:])
            continue
        r = json.loads(p.stdout.strip().splitlines()[-1])
        r["process_seconds"] = round(time.time() - t0, 2)  # includes interpreter + numpy/pandas import
        results[name] = r
    json.dump(results, open(os.path.join(HERE, "out", "results.json"), "w"), indent=1)
    for k, r in results.items():
        if "error" in r:
            print(k, "ERROR", r["error"]); continue
        print(f"{k:24} svc_window={r['service_level_window']:.3f} first_stockout={r['first_stockout_day']} unfilled={r['unfilled_units_total']:>5} "
              f"transit p50/p90={r['transit_days_into_customer']['p50']}/{r['transit_days_into_customer']['p90']} sim={r['wall_seconds']}s proc={r['process_seconds']}s")
