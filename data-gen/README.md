# FlowTwin v0 seed generator

`python3 data-gen/generate_seed.py` writes `app/src/data/seed/seed.json` (the `Seed` interface in `app/src/lib/types.ts`).
Python 3 standard library only. Deterministic (fixed seeds, fixed `asOf` = 2026-10-05, fixed `generatedAt`); re-running gives the same file.
Everything is synthetic. Signals are hand-seeded ("seeded for demo"); v0 calls no live feeds.

## World
- Customers: `qss` (QRO Seating Systems, Querétaro) and `slp-interiors` (San Luis Potosí).
- 12 suppliers: 11 for qss, 4 for slp-interiors (rpo, tps, mds are shared). 2 are `invited`, 1 is `public-only`, the rest `connected`.
- Full operating data (sites, partners, lanes, machines, certifications, uploads) only for `edl`. kpis, energy, materials, shipments, twins, requests, shares are empty.

## Risk engine (per customer and supplier)
1. **Normal transit** = ceil(road km / 400), min 1, with road km = 1.3 x straight-line distance (about 1 day per 400 km incl. loading).
2. **Active signals** for a day: signals whose dates cover that day and which touch the supplier (within `radiusKm` of its location, or sharing a highway). Day multiplier M = product of their `transitMultiplier`.
3. **Projection** (14 days): per day, 500 draws of `normal x M x lognormal(0, sigma)` with `sigma = 0.6 x lead-time variability`; P10/P50/P90 of the draws.
4. **Cover** of a part: `cover0 - min(gap, elapsed days + 1)` where `gap = normal x (M - 1)` is the median delay in days (deliveries are assumed on schedule at the P50 delay; the delay eats the buffer one day per elapsed day until the full gap is used). `coverDays` shows the most exposed part.
5. **daysToLineStop** = first day with projected cover <= 0 for a line-stopper or high-criticality part; null if none in 14 days.
6. **Exposure** = mean over 500 runs (one noise draw per run, applied across the 14 days) of `min(one shift = 480 min, shortfall days x 16 h x 60)` x EUR 15,000/min, so it is probability x minutes x cost. Weighted by criticality (line-stopper 1.0, high 0.4, normal 0.05). The most exposed part is reported; rounded to EUR 1,000. Used internally to pick the most exposed part and to order alerts; not shown in the UI or in alert text.
7. **Flex** (+15% for 28 days): bottleneck load x 1.15 against a practical ceiling (95% of nominal) plus finished-goods stock; `serviceLevel` = 1 - unmet/demand, `canAbsorb` if >= 98.5%, `daysToRecover` = backlog / spare capacity. `measured` for connected suppliers, else `estimated`.
8. **Score 0-100** = sum of driver points (integers that sum exactly to the score): signal delay vs cover (max 45, split over signals by log multiplier), criticality and single-source (max 16), thin cover (max 8), failed flex test (max 14), OTIF decline over 12 weeks (max 10), lead-time variability (max 8), missing data (invited 8, public-only 6).
9. **Level**: red if score >= 65 or daysToLineStop <= 3; amber if >= 35; else green.
10. **Alerts** for every non-green risk of qss with a scripted status; text is generated from the risk record so numbers always match.

Edit the tables at the top of the script (suppliers, parts, signals) to change the story, then re-run.
