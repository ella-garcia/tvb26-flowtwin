"""100-seed Monte Carlo per scenario, in-process. Run with ISOMORPH's python after run_spike.py:
   ../../../../ISOMORPH/.venv/bin/python mc_demo.py"""
import json
import os
import time

import numpy as np

import adapter

net = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "network.json")))
for name, kw in [("baseline", {}), ("slow plant->customer x2.6", dict(tt_mult={("edl-plant", "edl-p-qss"): 2.6})),
                 ("surge +15%", dict(surge=0.15)), ("surge +30%", dict(surge=0.30)), ("surge +60%", dict(surge=0.60))]:
    t = time.time()
    rs = [adapter.run(net, 60, seed=s, **kw) for s in range(100)]
    sl = [r["service_level_all"] for r in rs]
    print(f"{name:28} service mean {np.mean(sl):.4f}  p10 {np.percentile(sl, 10):.4f}  "
          f"P(any stockout) {np.mean([r['first_stockout_day'] is not None for r in rs]):.2f}  {(time.time() - t) / 100:.3f}s/run")
