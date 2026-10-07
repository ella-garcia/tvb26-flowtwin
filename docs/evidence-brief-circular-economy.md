# Evidence brief: circular supply chains and visibility (Oct 2026)

**Source:** Sadiq, M., Nisar, Q.A., Kautish, P., Sarma, P.R.S., Haider, S. (2026). *From circularity to sustainability: Leveraging Industry 4.0 for circular and supply chain resilience.* Technovation 157, 103653. https://doi.org/10.1016/j.technovation.2026.103653 (open access, CC BY).

## What the study did
- **Sample:** 371 senior managers of Chinese manufacturing firms, surveyed in three waves four months apart (time-lagged, to reduce common-method bias).
- **Method:** PLS-SEM with 5,000 bootstrap samples.
- **Constructs:**
  - Industry 4.0 adoption
  - Circular supply-chain practices (CSCP)
  - Supply-chain visibility (SCV), made up of learning, sensing and coordinating
  - Strategic alliances (SA)
  - Supply-chain resilience (RSC)
  - Sustainable supply-chain performance (SSCP)

## Findings we use
| Finding | Number | What it means for FlowTwin |
|---|---|---|
| Industry 4.0 → circular practices → sustainable performance | indirect β = 0.15 (direct effect of circular practices on performance β = 0.368) | Circular practices are the larger route to sustainability. We add a circular layer, not just more visibility. |
| Industry 4.0 → visibility → sustainable performance | indirect β = 0.053 | Visibility helps, but mostly alongside resilience (next row). |
| Resilience strengthens visibility → performance (H7b) | β = 0.088 | Early warning, our core, is the resilience that makes visibility pay off. Our "resilience pays twice" view shows the transport co-benefit. |
| Strategic alliances strengthen Industry 4.0 → circular practices (H6a) | β = 0.138 | The Tier 1 sponsoring its Tier 2s is the alliance. Circular data is shared inside that relationship, by consent, and milk runs are organised by the Tier 1. |
| Alliances do **not** strengthen Industry 4.0 → visibility (H6b) | β = −0.013, not significant | No feature depends on it. |
| Visibility dimensions | loadings: sensing 0.86, learning 0.81, coordinating 0.38 | The visibility index weights sensing 0.42, learning 0.39 and coordinating 0.19. |

**Practical advice in the paper we act on:**
- reduce reliance on raw materials and waste;
- sustainable procurement;
- smaller firms joining larger firms' networks to reach technology;
- AI-based visibility to predict disruptions and adjust operations.

## How the findings map to features
- **Visibility index** (`app/src/lib/visibility.ts`): sensing, learning and coordinating per supplier, from data already in FlowTwin. Shown on the risk board and the supplier page.
- **Transport footprint** (`worker/engine/circular.py`): truck-km, trucks, fill and CO₂e per supplier, estimated.
- **Resilience pays twice** (Sustainability page): the line-down days a scenario avoids, converted into expedited truck-km and CO₂e avoided.
- **Load consolidation / milk runs** (`worker/engine/milkrun.py`): Tier 1-led loops that never reduce delivery frequency.
- **Supplier circular profile and consent sharing:** scrap, recycled content, returnable packaging and renewable electricity, shared with one customer by the supplier owner. The circularity score is a first proxy for the paper's circular-practices construct.

## Caveats
- **Self-reported survey data**, from a single country (China), and correlational: PLS-SEM path coefficients are associations, not causal effects. Use them as direction, not as numbers to forecast with.
- **H7a is reported inconsistently.** The text says resilience *negatively* moderates circular practices → performance (β = −0.129) and the hypothesis is not supported. Table 6 lists β = 0.129, "Supported", and Fig. 6 is described as a positive moderation. **We do not cite H7a.**
- **Visibility weights:** the weights come from second-order loadings in one sample. They are a reasoned starting point and are not calibrated for Mexican automotive suppliers.
- **CO₂e:** uses a single estimated factor for an articulated diesel truck (≈1.05 kg CO₂e per vehicle-km, well-to-wheel), to be confirmed against the GLEC Framework v3. All CO₂e figures are marked estimated.
