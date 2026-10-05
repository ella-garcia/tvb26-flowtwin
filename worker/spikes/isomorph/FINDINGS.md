# ISOMORPH spike: can it replace the projection and flex test?

Date 2026-10-05. Scope: one supplier (Estampados del Laja, edl) supplying QSS. ISOMORPH was only read; nothing in `../ISOMORPH` was changed.

## Verdict: partly

ISOMORPH can be driven programmatically for one supplier's network and answers "what happens to delivery and service if a lane is slower or cut, or demand rises". It cannot yet replace the FlowTwin projection and flex test as they stand, because it has no production capacity, no per-day transit distribution, and a v2 file that does not run. It is a good candidate for the *lane / inventory propagation* part, not for the supplier's own bottleneck.

## What was run

`build_input.py` turns edl's rows (sites, partners, lanes, qss parts from seed.json) into a small dict. `adapter.py` builds an ISOMORPH `Network` from it and runs `SupplyChainSimulation` under `../ISOMORPH/.venv/bin/python` (Python 3.14, numpy 2.5, pandas 3). `run_spike.py` runs 5 scenarios by subprocess; `mc_demo.py` runs 100 seeds per scenario in-process. Results: `out/results.json` (regenerate, `out/` is git-ignored).

| Scenario (60 days, 3 parts) | Service, whole run | Result |
|---|---|---|
| baseline | 99.9% | transit into customer 1 day; 34% of seeds see a brief stock-out |
| plant to customer transit x2.6 (like the Orizaba rain case) | 98.8% | transit 3 days; stock-out in 100% of seeds |
| plant to customer edge cut for 4 days | 93% in the window | 142 units unfilled, first stock-out day 24 |
| +15% demand for 28 days | 99.9% | no change: edge spare capacity (25%) is not binding |
| +30% / +60% demand | 98.4% / 70.8% | edge capacity binds |

## Runtime

About 0.01 s per 60-day run in-process (3 items, 6 nodes); about 0.5 s per run as a subprocess (interpreter plus numpy/pandas import). 100 seeds take about 1 s in-process. So a 14-day look-ahead with a few hundred Monte Carlo seeds per supplier is cheap. It scales with units shipped (the packer allocates one unit at a time), which is why the adapter uses 1 unit = 100 pieces. Real piece counts (3,600 per day per part) would be roughly 100 times slower. The full network of 50 items and 7,300 days is a different regime and not needed.

## What maps cleanly

- Sites, partners and lanes become nodes and directed edges. Inbound supplier partners are sources, the plant is an intermediate node, the customer partner is the destination.
- Lane `km` becomes travel time (same `ceil(km x 1.3 / 400)` rule as the engine); `trips_per_week` becomes containers per day.
- Partner `lead_time_days` and `lead_time_variability` become source replenishment lead time and its std fraction (this is real stochasticity in ISOMORPH).
- Part `days_of_cover` and `daily_usage` become the customer's initial inventory and demand; a backlog at the destination is a stock-out (line stop).
- Disruptions: slower transit = scale an edge's `travel_time_days`; a capacity cut works on `reset_daily_edges`; both done in the adapter. Demand surge = scale the demand function (the simulator takes any `demand_fn`).

## What does not map

1. **Broken v2 file.** `Supplychaingeo_item50_v2.py` imports `Supplychaingeo_item50_inv`, which is not in the repo (`ModuleNotFoundError`), and calls `reset_daily_edges(..., disabled=...)`, which the base `Network` does not accept. So `--disable_edges`, `--ss_*`, `--edge_tt_std_frac` and `--containers_scale` via v2 CLI do not run today. The adapter imports the base `Supplychaingeo_item50.py` and re-implements the edge cut. Ask the authors for the `_inv` file, or vendor and fix v2 (MIT licence).
2. **Hard-coded US network.** The CLI always builds the 13-node US network; the topology is only buildable programmatically via `build_network_from_adjacency` plus `SupplyChainSimulation` (which the adapter does). Supported, but not a documented API.
3. **Single destination, pure distribution.** One destination node, no bill of materials, no transformation at the plant: coil in does not become brackets out, so sources must carry the same SKUs as the customer buys. edl's other customers (Aguascalientes, Silao) need a separate run each.
4. **No production capacity.** The supplier's bottleneck (Press 4 at 88% utilisation, ceiling 95%) has no counterpart. This is exactly what the current flex test measures, so the +15% surge in ISOMORPH only tests lane capacity and stock, and it passed at +15%. The flex test cannot be replaced until a capacity-limited plant node exists (the v2 reservoir / finite-supply knob is the closest, and it is in the broken file).
5. **No transit-time distribution.** Transit is the deterministic sum of edge times, so P10/P50/P90 per day need either `edge_tt_std_frac` (v2, broken) or our own noise. Signal multipliers (rain x2.6) map to a scale on edge times; the 14-day schedule of signals needs a per-day multiplier, which is an easy hook in `step`.
6. **Capacity and policy data are not in the schema.** Truck capacity (volume per trip), (s,S) levels and starting stock of partners are guesses (25% spare, 12 days of stock). Needs new fields or defaults per partner.
7. **Units.** Items are volumes and counts of units; mapping needs a unit size (done: 100 pieces). Lane `fill_rate` is unused.
8. **Interpreter.** ISOMORPH venv is Python 3.14; the worker targets 3.12. Either run the adapter by subprocess (0.5 s overhead, clean isolation), or vendor the base simulator file (about 1,200 lines, needs numpy + pandas) into the worker.
9. **Output shape.** We need `projection[]` (date, P10/P50/P90 transit, cover) and `flex{canAbsorb, serviceLevel, daysToRecover}`. These come from aggregating many seeds: service level, P(stock-out), and the shipments' arrival minus departure. The adapter returns the raw pieces; the aggregation is not done.

## Recommended next step

1. Keep the engine as the production path for now (it is cheap, deterministic and tested against the seed).
2. Run ISOMORPH as a **second opinion on lane disruption only**: add a per-day transit multiplier hook, 200 seeds per supplier, output the same `projection[]` shape, and compare to the Monte Carlo for the 5 suppliers with signals (hmo, pip, tsr, edl, rdp). Decide on agreement, not on looks.
3. Before anything touches the flex test: ask the ISOMORPH authors for the missing `_inv` module, then add a capacity-limited plant node (production rate and ceiling from `machines`) so that "+15% demand" meets a real bottleneck.
4. Schema additions the adapter would need (for the other phase owners): truck capacity per lane, partner stock policy (or defaults), item unit size, and which partner supplies which part.

## Files

`build_input.py`, `adapter.py`, `run_spike.py`, `mc_demo.py` in this folder. Run: `python3 run_spike.py` then `../../../../ISOMORPH/.venv/bin/python mc_demo.py`.
