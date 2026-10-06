# Business case references: supply chain digital twins

*Compiled 6 Oct 2026 · FlowTwin v0 (Tier 1 early warning, Mexico)*

Industry sources on supply chain digital twins, and what each one supports in the FlowTwin business case.
Figures are as reported by the sources. Check the exact wording on the page before citing a number in a deck or report.

## 1. BCG, *Using Digital Twins to Manage Complex Supply Chains* (29 Jul 2024)
Rainer Schuster, Llorenç Mitjavila, Camila Penazzo. https://www.bcg.com/publications/2024/using-digital-twins-to-manage-complex-supply-chains

**What it says**
- **Definition:** a supply chain digital twin is a virtual replica of the end-to-end chain. It combines AI, simulation and scenario planning to anticipate risks, predict bottlenecks and optimise operations.
- **Use cases:** demand and supply forecasting with risk assessment, early disruption detection and alerts, procurement optimisation, scenario simulation, and automated decisions.
- **Reported benefits:**
  - 20–30% better forecast accuracy
  - 50–80% fewer delays and less downtime
  - 3–6% lower procurement costs
  - up to 85% of planning automated, with procurement cycle time cut by 50%
- **Case (steel manufacturer):**
  - Scale: 50 assets, 300+ warehouses, 20,000+ SKUs.
  - Risks identified about **12 weeks** in advance.
  - 15% less inventory and about 2 points of EBITDA gained.
- **Barriers:** siloed and incomplete data, reactive analysis, manual processes, and low adoption when tools are complex.
- **How to start:** build incrementally on existing systems, start with high-value decisions, make the interface intuitive, and keep the architecture modular and technology-agnostic. One SAP-based client went live in about **three months**.

**What it supports for FlowTwin**
- The core promise, early detection and alerts before a disruption hits, is what the risk board and alerts do.
- The "50–80% fewer delays and downtime" range frames the value of avoiding line stops. Keep it qualitative: our own impact is shown in days to line stop, not money (see `docs/evidence-brief-professor-feedback.md`).
- "Start incrementally on existing systems" backs our light onboarding: Excel and ERP exports with Spanish headers, and suppliers joining free.
- "Low adoption when tools are complex" backs the simple traffic light and the plain-language drivers.

## 2. RELEX Solutions, *Digital twins in supply chain management* (6 Sep 2024)
Fredrik Rahm, Solution Principal CPG. https://www.relexsolutions.com/resources/digital-twin-supply-chain/

**What it says**
- **Definition:** virtual replicas of physical supply chain systems, fed with real-time data and AI. They let companies test scenarios and simulate operations without disrupting real processes.
- **Use cases:** forecasting and replenishment, scenario planning for demand shifts and supply disruptions, inventory visibility and optimisation, simulating production lines, and spotting bottlenecks.
- **Case (Vita Coco, CPG):**
  - Accurate 18-month supply plans.
  - "Millions of dollars" of cost-of-goods value from better sourcing and distribution planning. No exact figure is given.
- **Barriers:** unrealistic expectations, gaps between planning and IT, data quality and complexity, no clear data ownership, and perfectionism.
- **Recommendations:**
  - Understand how the technology works before implementing it.
  - Use one shared platform across teams.
  - Set up data governance with a named owner.
  - Improve iteratively rather than aiming for perfect.

**What it supports for FlowTwin**
- Scenario planning for supply disruptions matches the 14-day projection and the +15% demand test.
- Inventory visibility as a core use case backs the Parts & stock page, which the professor called key.
- "Clear data ownership" and "one shared platform" back the sharing model: the Tier 1 and its suppliers see the same risk view, and costs and margins are never shared.
- The source is CPG and retail-focused, so use it for general digital-twin benefits rather than automotive specifics.

## How to use these in the business case
- **Positioning:** FlowTwin applies the digital-twin approach that BCG and RELEX describe for large companies to a gap they don't cover: Mexican Tier 1 plants and their small Tier 2 suppliers.
- **The angle:** short-horizon early warning (14 days) instead of long-horizon planning, priced so the Tier 1 sponsors its suppliers.
- **Gap:** neither source has automotive-specific figures. Pair them with the automotive cases in the evidence brief: Honda Celaya and Nexperia, Nuevo Laredo and Manzanillo customs, and Tier 1 seat plants serving several models.
- **Two horizons, following BCG's 12-week example:** FlowTwin now looks ahead on two horizons.
  - **14 days, daily:** a Monte Carlo projection from live weather, road and customs signals. It drives alerts and line-stop days.
  - **12 weeks, weekly:** an estimated outlook from signals known in advance (rainy and hurricane season, year-end border peaks, holiday traffic). Each week is rated High, Watch or OK against the cover of the supplier's critical parts.
  - The 12-week view cannot foresee unannounced events, and the product says so.
