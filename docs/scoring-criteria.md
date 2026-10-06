# FlowTwin scoring criteria

*6 Oct 2026 · applies to branch `optimization-score` (commit a82a13c) · figures from the demo data dated 5 Oct 2026*

FlowTwin uses four scores. Two of them run in opposite directions, so always read the label:

| Score | Range | Better is | Where it shows | What it answers |
|---|---|---|---|---|
| **Optimization score** | 0–100 | **higher** | Risk board, What-if | How healthy are my at-risk suppliers over the horizon, with and without the recommended optimizations? |
| **Weekly outlook level** | High / Watch / OK | OK | Risk board grid, supplier page, What-if | How exposed is this supplier in this week? |
| **Supplier risk score** | 0–100 | **lower** | Supplier page, drives the risk light | How likely is a problem with this supplier in the next 14 days, and why? |
| **Delivery grade** | A / B / C | A | Risk board, supplier page | How has this supplier delivered over the last 12 weeks? |

All four are estimates. Each figure in the app has a "How it is calculated" panel with the same rules as this page.

---

## 1. Optimization score

### 1.1 Scope
- **Horizon:** 2, 4 or 12 weeks, chosen by the user.
- **Suppliers counted:** only those with at least one week that is not OK in the horizon when no action is taken (the *at-risk suppliers*). A supplier that is OK all along can't improve, so including it would only dilute the score.
- **Model filter:** with a vehicle model selected, only suppliers of parts for that model are counted.
- **Unit:** the supplier-week (one supplier in one week).

### 1.2 Points per supplier-week
Each supplier-week gets a level from the weekly outlook rule (section 2), then points:

| Level | Points |
|---|---|
| OK | 0 |
| Watch | 1 |
| High | 2 |

High counts double because a High week means the expected delay would use up the cover of a critical part, so the line could stop.

### 1.3 Formula
```
score = 100 × (1 − (2 × High weeks + Watch weeks) ÷ (2 × at-risk suppliers × weeks))
```
- 100 means every week of every at-risk supplier is OK.
- 0 means every one of those weeks is High.
- With no at-risk supplier in the horizon, the score is 100.
- The score is rounded to a whole number.

**Before** is the score with no action. **After** is the score with the optimizations each supplier adopts in the current scenario. The change is shown as ▲/▼ points.

### 1.4 Bands

| Score | Band | Reading |
|---|---|---|
| 85–100 | **Good** | Risks are short and covered; at most an occasional Watch week. |
| 60–84 | **Fair** | Several Watch weeks, or a few High weeks; act on the top lever. |
| 0–59 | **Poor** | Repeated High weeks; a line stop is likely without action. |

### 1.5 Worked example (demo data, 12 weeks, QRO Seating Systems)

| | At-risk suppliers | High weeks | Watch weeks | Calculation | Score |
|---|---|---|---|---|---|
| No action | 5 | 3 | 18 | 100 × (1 − (6 + 18) ÷ 120) | **80, Fair** |
| All 5 adopt | 5 | 0 | 6 | 100 × (1 − (0 + 6) ÷ 120) | **95, Good** |

### 1.6 Who adopts (the scenario)
- **Random:** with "Randomize optimizations", each at-risk supplier adopts all of its recommended optimizations with the chosen probability (0–100%, default 50%).
  - Draws are seeded and numbered, so a given draw can be repeated.
  - Suppliers are drawn in a fixed order (by id), so the risk board and What-if always show the same draw.
- **By hand:** "All adopt", "None adopt", or ticking individual actions on What-if.
- **Spread:** What-if also runs 500 random draws at the chosen share and shows the middle 80% range and the median.

### 1.7 Industry view (automaker / bank lens)
A toggle next to the score (**Operational / Industry view**, shared by the risk board and What-if) shows how an automaker or a bank would read the same supplier base. It changes four rules (`app/src/lib/industry.ts`).

| Rule | Operational | Industry view |
|---|---|---|
| Who counts | At-risk suppliers only | **Every supplier** |
| Structural weaknesses | Not counted | Set a **floor** on every week: 1–2 flags = 0.5 points, 3 or more = 1 point (Watch) |
| Optimizations | Work fully, at once | Work with **75% probability**. "With optimizations" is the expected score, with a range from none working (= no action) to all working. |
| Line stops | Averaged in | **Weakest link:** while any week still expects ≥ 0.5 days of line stop, the score is **capped at 59 (Poor)** |

**Structural flags**, all from data FlowTwin already holds:
- single-source critical (line-stopper or high) part
- near capacity: 85% or more used (headroom ≤ 15%)
- more than 40% of the supplier's sales go to this customer
- imported inputs: a border, customs or port leg, or customs exposure
- shares no data (invited, or not on FlowTwin)
- delivery grade C
- cannot absorb +15% demand

**Demo result** (12 weeks, all at-risk suppliers adopt):

| | Operational | Industry view |
|---|---|---|
| No action | 80 (Fair) | **59 (Poor)**, capped: a line stop is still expected at Hules y Mangueras de Orizaba |
| With optimizations | 95 (Good) | **76 (Fair)**, range 59–77; the cap lifts because the expected stop falls below 0.5 days a week |

9 of 12 suppliers have structural flags. Estampados del Laja and Orizaba each have 4 or more, so they count as Watch every week, even though Estampados' outlook is all OK.

---

## 2. Weekly outlook level (High / Watch / OK)

For each supplier and week, the engine (`worker/engine/outlook.py`) compares two numbers.

1. **Expected delay:** the largest extra transit time that week, from signals known in advance.
   - Signals count only if they reach the supplier: within the signal's radius, or on the same highway.
   - For imports with route legs, a signal slows only the legs it can reach. Customs outages hit border and customs legs; road closures hit road legs; weather hits any leg in range.
2. **Cover:** the lowest days of cover among the supplier's **line-stopper and high** parts at the key customer. If there are none, the lowest cover of any part.

| Level | Rule |
|---|---|
| **High** | expected delay ≥ cover |
| **Watch** | expected delay ≥ half the cover, **or** ≥ 1 day |
| **OK** | otherwise |

**Line-down days** = expected delay − cover, capped at 7 per week (0 when the cover is enough). They feed line uptime and revenue (section 4).

Only signals known in advance count: live forecasts, seasonal patterns and announced events. The outlook can't foresee an event nobody has announced.

---

## 3. Recommended optimizations and their effect

Each supplier gets up to **3** recommended optimizations. They are chosen first from the signal types that reach it within 12 weeks, then from its parts. The engine (`worker/engine/scenarios.py`) computes every combination of them (at most 8) with the rule in section 2. The app only picks one of these results; it never recomputes risk.

| Optimization | Lever | Recommended when | Effect in the model | Timing |
|---|---|---|---|---|
| Priority customs release | Customs | Customs or port signals reach the supplier | Halves the extra time from customs and port signals | From week 1 |
| Use an alternative route | Route & weather | Road, blockade or weather signals reach the supplier | Removes 60% of that extra time | From week 1 |
| Move departures to daytime | Security | Theft signals reach the supplier | Removes the theft delay | From week 1 |
| Agree a daily ship plan | Supplier operations | The supplier has its own problem (e.g. a machine breakdown) | Halves that delay | From week 1 |
| Add 2 days of safety stock | Stock | Always (if room among the 3) | +2 days of cover on critical parts | From week 1 |
| Qualify a second source | Second source | A critical part is single-source | Delay no longer threatens the line (week is OK) | From week 11 (about 10 weeks of PPAP) |
| Pull the next orders forward | Stock | If room among the 3 | +1.5 days of cover | Weeks 1–2 only |

These percentages are modelling assumptions. They have not been measured yet.

---

## 4. Supporting metrics shown with the score

| Metric | Where | Rule |
|---|---|---|
| **Benefit by lever** | Risk board | Each optimization on its own vs no action, summed over suppliers. *Risk-weeks better* counts each step down per week (High→Watch = 1, High→OK = 2, Watch→OK = 1). Also *line-down days avoided*, and how many suppliers improve. |
| **Line uptime %** | Risk board, What-if | Per model and week: 1 − (line-down days ÷ 7). A model is down for the worst supplier of its line-stopper or high parts that week. The total is weighted by planned vehicles per day. |
| **Revenue lost / protected** (MXN) | What-if only | Vehicles not built = line-down days × planned vehicles per day. Lost = vehicles × the Tier 1's content value per vehicle (estimated: K3 MX$21,000, M5 MX$17,500, T1 MX$24,000). Protected = lost with no action − lost with the optimizations. |
| **Revenue at risk by week** (MXN) | What-if only | Per week: line-down days × planned vehicles per day × content value per vehicle, summed over models; no action vs the chosen optimizations. |
| **Return on each optimization** (MXN) | What-if only | Each optimization on its own, one supplier at a time, vs no action: revenue protected, stock it adds, and protected per peso of stock. Route, customs, security and second source are not costed. |
| **Revenue gained from +15% demand** (MXN) | What-if only | Extra volume = 15% × planned vehicles per day × days in the horizon × content value per vehicle. A supplier delivers (service level under the surge × 1.15 − 1) ÷ 0.15 of the extra; a model takes the share of its weakest supplier of critical parts. |
| **Stock added** (MXN) | What-if only | Added days × daily usage × the Tier 1's unit cost, per critical part. Route, customs and second-source actions are not costed: the data has no freight or qualification costs. |

**Money rule:** no money on the risk board, alerts or emails. MXN only on What-if, from the Tier 1's own data, always marked estimated (see `BRIEF.md`). Each alert links to What-if filtered to its supplier ("See value at risk in What-if"), so the money is one click away but never inside the alert or email. Unit prices are not shown on the supplier page, which suppliers also see.

---

## 5. Supplier risk score (0–100, higher = riskier) and the risk light

Computed by `worker/engine/scoring.py` from the 14-day projection. It is the sum of driver points; if the drivers add up to more than 100, all are scaled down so the total is 100.

| Driver | Max points | Rule |
|---|---|---|
| Delay vs cover | 45 | 45 × min(1, worst-case extra transit (P90) ÷ cover of the most exposed part ÷ 2), split across the active signals that cause it |
| Criticality and sourcing | 16 | Line-stopper 10, high 5, normal 1; +6 if single-source |
| Thin cover | 8 | Critical part only: 8 × (5 − cover days) ÷ 4, from 0 at 5 days to 8 at 1 day or less |
| Cannot absorb +15% demand | 14 | 14 × (99% − service level under the surge) ÷ 8 points, minimum 3 when it fails |
| Falling delivery (OTIF) | 10 | 10 × (OTIF drop, first 4 weeks vs last 4) ÷ 6 points |
| Lead-time variability | 8 | 8 × variability ÷ 40% |
| Missing supplier data | 8 / 6 | Invited, not yet sharing data: 8. Not on FlowTwin: 6 |

Each "÷" rule is capped between 0 and its maximum.

| Risk light | Rule |
|---|---|
| **Act now** (red) | score ≥ 65, **or** a line stop within 3 days |
| **Watch** (amber) | score ≥ 35 |
| **OK** (green) | otherwise |

---

## 6. Delivery grade (A / B / C)

12-week average OTIF against the contract target (98% unless set otherwise):

| Grade | Rule |
|---|---|
| A, on target | average ≥ target |
| B, slightly below | up to 3 points below target |
| C, below target | more than 3 points below |

The grade looks back and the risk light looks forward. They are shown side by side and never merged.

---

## 7. Limitations and points to validate
1. **Weights:** High = 2 and Watch = 1 is a simple convention. Check with the advisor whether a High week should weigh more, for example 3.
2. **Bands:** the 85 / 60 boundaries were set from the demo data and should be calibrated on real suppliers.
3. **Cover:** the cover is taken as the standing buffer for the whole horizon. Demand changes from releases are not in the outlook yet.
4. **Optimization effects:** the percentages in section 3 are assumptions. Ideally they would be measured after real actions, for example customs release times before and after using a priority broker.
5. **Score direction:** the risk score (higher = worse) and the optimization score (higher = better) run in opposite directions. Keep the labels explicit in every view.
6. **Money:** revenue per vehicle and unit costs are the Tier 1's own data in the product. The demo values are fictional.
7. **Industry view parameters:** 75% execution, the 0.5-day cap, the 59 cap, and the flag thresholds (85% capacity, 40% of sales) are assumptions to calibrate with an automaker or bank scorecard.
8. **Not yet in the industry view:** financial health (needs supplier consent and financial data), a base rate for unannounced disruptions (e.g. McKinsey's one disruption of a month or more every 3.7 years), and quality (defect rate, certification status).
9. **Sensitivity:** each supplier's share of sales to the customer is visible to that customer in the industry view. Confirm suppliers agree to share it.
