// Shared domain model for FlowTwin v0. Every page and the seed generator follow these shapes.
// Owned by the lead; feature work should not change it without coordinating.

export type RoleId = "admin" | "owner" | "ops" | "customer";
export type PlanId = "free" | "paid" | "sponsored";
export type SizeBand = "micro" | "small" | "medium" | "large";
/** Position in the chain for ONE customer relationship (never stored per company). */
export type ChainPosition = "brand" | "direct" | "sub" | "raw" | "distributor";
export type Provenance = "measured" | "estimated";
export type Risk = "low" | "medium" | "high";

export interface Company {
  id: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  kind: "supplier" | "customer";
  sizeBand: SizeBand;
  employees: number;
  scian: string;              // Mexican industry code (SCIAN)
  packIds: string[];          // industry packs the company belongs to
  synthetic: boolean;         // generated peer, not a real company
  contact?: { name: string; email: string; role: string };
}

/** A supplier's relationship with one of its customers. Segment labels are derived from this + the pack. */
export interface CustomerRelationship {
  supplierId: string;
  customerId: string;         // a Company id when the customer is on the platform, else a Partner id
  chainPosition: ChainPosition;
  shareOfSales: number;       // 0..1
  requirements: RequirementProfile;
}

export interface RequirementProfile {
  otifTarget: number;         // 0..1
  ppmTarget: number;          // defects per million
  approvalLevel: number;      // e.g. PPAP level in the auto pack
  certifications: string[];   // required certifications, names from the pack
}

export interface Site {
  id: string;
  companyId: string;
  name: string;
  type: "plant" | "warehouse" | "dc";
  city: string;
  lat: number;
  lon: number;
  palletPositions: number;
  rentedPositions: number;
}

/** A supplier or customer as seen from one company's network. */
export interface Partner {
  id: string;
  companyId: string;          // whose network this partner belongs to
  name: string;
  role: "supplier" | "customer";
  city: string;
  lat: number;
  lon: number;
  linkedCompanyId?: string;   // set when the partner is itself on the platform (e.g. Customer A)
  material?: string;          // for suppliers: material id from the pack (e.g. "steel-coil")
  leadTimeDays?: number;
  leadTimeVariability?: number; // coefficient of variation, 0..1
}

export interface Lane {
  id: string;
  companyId: string;
  fromId: string;             // Site or Partner id
  toId: string;               // Site or Partner id
  direction: "inbound" | "outbound" | "internal";
  highway?: string;           // e.g. "MEX-57D"
  km: number;
  tripsPerWeek: number;
  fillRate: number;           // 0..1
  theftRisk: Risk;
  nightShare: number;         // share of trips leaving 20:00–05:00, 0..1
  costPerTripMxn: number;
}

export interface Machine {
  id: string;
  companyId: string;
  name: string;
  capacityTonnes: number;
  shiftsPerWeek: number;
  utilization: number;        // 0..1
}

export interface Certification {
  companyId: string;
  name: string;               // e.g. "IATF 16949"
  validUntil: string;         // ISO date
}

/** One indicator value. `customerId` set for per-customer scorecard values. */
export interface KpiValue {
  companyId: string;
  kpiId: string;              // id from the pack's kpi list
  customerId?: string;
  value: number;
  provenance: Provenance;
  asOf: string;               // ISO date
}

export interface EnergyMonth {
  companyId: string;
  month: string;              // "2025-01"
  electricityKwh: number;
  dieselLitres: number;       // own fleet and forklifts
  naturalGasM3: number;
  source: string;             // e.g. "CFE bill 2025-01"
}

export interface MaterialPurchase {
  companyId: string;
  material: string;           // pack material id
  tonnes: number;
  year: number;
  source: string;
}

export interface Shipment {
  companyId: string;
  customerId: string;
  year: number;
  tonnes: number;             // used to split the footprint by customer
}

export interface EmissionFactor {
  id: string;
  name: string;
  value: number;
  unit: string;               // e.g. "kg CO2e/kWh"
  scope: 1 | 2 | 3;
  source: string;
  year: number;
  version: number;
}

/** The twin of one company's network, rebuilt from its data. v0: produced by the seed generator. */
export interface Twin {
  companyId: string;
  syncedThrough: string;      // ISO date of the latest data in the twin
  builtAt: string;
  counts: { items: number; sites: number; partners: number; lanes: number };
  accuracy: TwinAccuracy[];   // replay vs actual over the last 90 days
  overallAccuracy: number;    // 0..1
  days: TwinDay[];            // 90 days, oldest first
}

export interface TwinAccuracy {
  kpiId: string;
  actual: number;
  simulated: number;
  score: number;              // 0..1, 1 = identical
}

export interface TwinDay {
  date: string;
  otifActual: number;
  otifTwin: number;
  /** Units on hand per Site/Partner id. */
  stock: Record<string, { actual: number; twin: number }>;
  /** Trucks dispatched and average fill per lane that day. */
  lanes: Record<string, { trucks: number; fill: number }>;
  stockouts: string[];        // node ids with a stockout that day
}

/** A key customer's request to a supplier. */
export type ShareItem = "scorecard" | "carbon";
export interface DataRequest {
  id: string;
  fromCompanyId: string;      // the key customer
  toCompanyId: string;        // the supplier
  items: ShareItem[];
  fiscalYear: number;
  sentAt: string;
  dueDate: string;
  status: "open" | "in-review" | "answered";
  note?: string;
}

/** What a supplier has explicitly shared with one customer. Payloads are frozen at approval. */
export interface Share {
  id: string;
  supplierId: string;
  customerId: string;
  requestId?: string;
  items: ShareItem[];
  approvedBy: string;
  approvedAt: string;
  version: number;
  revoked?: boolean;
  scorecard?: ScorecardPayload;
  carbon?: CarbonPayload;
}

export interface ScorecardPayload {
  period: string;             // e.g. "Jul–Sep 2026"
  rows: { kpiId: string; label: string; value: number; target: number; unit: string; status: "on-track" | "watch" | "below" }[];
  certifications: { name: string; validUntil: string; required: boolean }[];
}

export interface CarbonPayload {
  fiscalYear: number;
  allocationMethod: "tonnes-shipped";
  allocationShare: number;    // share of the supplier's footprint allocated to this customer
  totalTco2e: number;         // supplier total
  allocatedTco2e: number;     // allocated to this customer
  byScope: { scope: 1 | 2 | 3; label: string; tco2e: number }[];
  lines: { label: string; scope: 1 | 2 | 3; activity: number; activityUnit: string; factorId: string; factorVersion: number; tco2e: number; source: string }[];
}

/** Raw uploads, as recorded by the intake flow. */
export type UploadKind = "sales-orders" | "purchase-orders" | "inventory" | "item-master" | "quality" | "freight" | "energy" | "fuel";
export interface UploadRecord {
  companyId: string;
  kind: UploadKind;
  fileName: string;
  rows: number;
  source: string;             // "Excel", "CONTPAQi export", …
  status: "waiting" | "uploaded" | "needs-input";
  uploadedAt?: string;
}

/** The whole seed, as loaded by the data layer. Produced by data-gen/generate_seed.py. */
export interface Seed {
  generatedAt: string;
  asOf: string;               // "today" for the demo
  companies: Company[];
  relationships: CustomerRelationship[];
  sites: Site[];
  partners: Partner[];
  lanes: Lane[];
  machines: Machine[];
  certifications: Certification[];
  kpis: KpiValue[];
  energy: EnergyMonth[];
  materials: MaterialPurchase[];
  shipments: Shipment[];
  emissionFactors: EmissionFactor[];
  twins: Twin[];
  requests: DataRequest[];
  shares: Share[];
  uploads: UploadRecord[];
  // ---- Early warning (v0 core) ----
  settings: Settings;
  parts: Part[];
  signals: Signal[];
  risks: RiskAssessment[];
  alerts: Alert[];
  invites: Invite[];
}

// ======================= Early warning (v0 core) =======================

export interface Settings {
  /** OEM line-stop cost from contract terms, as given by our advisor. To validate. */
  lineStopCostEurPerMinute: number;
  /** Demand change the contracts allow; the flex test uses it. */
  contractDemandSwing: number;           // 0.15
  /** Hours per day the OEM line runs, used to turn days into minutes of stoppage. */
  lineHoursPerDay: number;
}

/** A part a supplier delivers to a key customer, with the key customer's stock of it. */
export interface Part {
  id: string;
  number: string;              // part number, e.g. "4471-BRK"
  name: string;                // e.g. "Seat track bracket"
  supplierId: string;          // Company id of the supplier
  customerId: string;          // Company id of the key customer
  unitCostMxn: number;
  dailyUsage: number;          // units per production day at the key customer
  onHand: number;              // key customer's stock, units
  daysOfCover: number;         // onHand / dailyUsage
  singleSource: boolean;
  /** Line-stopper = no substitute and the OEM line stops without it (a screw can be one). */
  criticality: "line-stopper" | "high" | "normal";
}

export type SignalKind = "weather" | "road" | "theft" | "port" | "blockade" | "supplier";
/** An external or supplier event that can delay deliveries. */
export interface Signal {
  id: string;
  kind: SignalKind;
  title: string;               // "Rainy season, central Veracruz"
  description: string;
  state: string;               // Mexican state
  lat: number;
  lon: number;
  radiusKm: number;
  highways: string[];          // affected highways, e.g. ["MEX-150D"]
  startsAt: string;            // ISO date
  endsAt: string;
  severity: "low" | "medium" | "high";
  /** Multiplier on normal transit time while active, e.g. 2.5 = 2 days becomes 5. */
  transitMultiplier: number;
  source: string;              // "SMN/CONAGUA seasonal outlook (seeded)", …
  provenance: Provenance;
}

export type RiskLevel = "green" | "amber" | "red";

/** Forward projection for one supplier's main lane, from the twin. */
export interface ProjectionDay {
  date: string;
  transitP10: number;          // days
  transitP50: number;
  transitP90: number;
  coverDays: number;           // key customer's cover of the most exposed part, projected
}

/** Can the supplier absorb the contract demand swing (+15%)? Result of a twin run. */
export interface FlexResult {
  demandIncrease: number;      // 0.15
  canAbsorb: boolean;
  serviceLevel: number;        // fill rate under the surge, 0..1
  daysToRecover: number | null;
  headroom: number;            // spare capacity before the surge, 0..1
  bottleneck: string;          // "Press 4 (400 t)", "Coil supply from Monterrey", …
  provenance: Provenance;
}

export interface RiskDriver {
  label: string;               // "Rainy season adds 3 days to transit"
  kind: SignalKind | "cover" | "flex" | "history";
  signalId?: string;
  contribution: number;        // points of the 0–100 score
}

/** The traffic light for one supplier, as seen by one key customer (and by the supplier itself). */
export interface RiskAssessment {
  customerId: string;
  supplierId: string;
  level: RiskLevel;
  score: number;               // 0–100, higher = riskier
  normalTransitDays: number;
  expectedTransitDays: number; // P50 over the next 14 days
  worstCaseTransitDays: number;// P90
  minCoverDays: number;        // lowest days of cover among this supplier's parts
  /** Days until the key customer's line stops if nothing is done; null = no stop expected in 14 days. */
  daysToLineStop: number | null;
  lineStopExposureEur: number; // expected cost if it stops (minutes × cost per minute × probability)
  drivers: RiskDriver[];
  flex: FlexResult;
  otifTrend: number[];         // last 12 weeks, 0..1
  projection: ProjectionDay[]; // next 14 days
  dataStatus: "connected" | "invited" | "public-only"; // how much of the supplier's own data feeds the score
  updatedAt: string;
}

export interface AlertAction { id: string; label: string; description: string }
export interface Alert {
  id: string;
  customerId: string;
  supplierId: string;
  partIds: string[];
  signalId?: string;
  level: RiskLevel;
  title: string;               // "Transit from Orizaba goes from 2 to 5 days"
  message: string;             // what happens if nothing is done
  createdAt: string;
  expectedShortfallDate?: string;
  lineStopExposureEur: number;
  status: "new" | "acknowledged" | "supplier-responded" | "resolved";
  actions: AlertAction[];
  chosenActionId?: string;
  supplierResponse?: { by: string; at: string; message: string; confirmedCapacity: boolean };
}

/** A key customer inviting a supplier onto the platform (sponsored, free for the supplier). */
export interface Invite {
  id: string;
  customerId: string;
  supplierId?: string;         // set when the supplier exists in the directory
  supplierName: string;
  contactEmail: string;
  sentAt: string;
  status: "sent" | "joined";
  plan: "sponsored";
}
