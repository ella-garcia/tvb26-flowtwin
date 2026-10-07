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
  /** Set by the upload worker (live mode). */
  issues?: UploadIssue[];
  mapping?: Record<string, string>;   // "your column" -> canonical field it was read as
  jobId?: number;
}

export interface UploadIssue { row?: number; column?: string; message: string; severity: "error" | "warning" | "info" }

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
  uploads: UploadRecord[];
  // ---- Early warning (v0 core) ----
  settings: Settings;
  parts: Part[];
  programs: VehicleProgram[];
  signals: Signal[];
  risks: RiskAssessment[];
  alerts: Alert[];
  invites: Invite[];
  alertNotifications?: AlertNotification[];
  // ---- Circular and sustainability layer ----
  emissionFactors?: EmissionFactor[];
  consolidationPlans?: ConsolidationPlan[];
  circularProfiles?: CircularProfile[];
  requests?: DataRequest[];
  shares?: Share[];
}

// ======================= Early warning (v0 core) =======================

export interface Settings {
  /** OEM line-stop cost from contract terms, as given by our advisor. To validate. */
  lineStopCostEurPerMinute: number;
  /** Demand change the contracts allow; the flex test uses it. */
  contractDemandSwing: number;           // 0.15
  /** Hours per day the OEM line runs, used to turn days into minutes of stoppage. */
  lineHoursPerDay: number;
  /** Transport footprint and consolidation (engine inputs; shown in formula panels). */
  palletsPerTruck?: number;              // 24
  expediteTripsPerShortDay?: number;     // expedited trips per line-down day avoided
  expediteFillRate?: number;             // expedites run mostly empty
  milkrunRadiusKm?: number;              // suppliers this close can share a loop
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
  /** Units shipped by the supplier and not yet received (from ASNs or the stock upload). Absent = unknown. */
  inTransit?: number;
  /** Finished goods for this part at the supplier, units. Only when the supplier shares its data. Absent = not shared. */
  supplierFgOnHand?: number;
  /** Arrival date of the next delivery, when known (ASN / supplier confirmation). Absent = estimate from expected transit. */
  nextDeliveryDate?: string;
  /** Vehicle programmes (models) this part goes into. Absent or empty = not mapped yet. */
  programIds?: string[];
  /** Units per pallet (key customer's logistics data). Absent = engine default, marked estimated. */
  unitsPerPallet?: number;
  singleSource: boolean;
  /** Line-stopper = no substitute and the OEM line stops without it (a screw can be one). */
  criticality: "line-stopper" | "high" | "normal";
}

/** A vehicle model the key customer builds for, at one OEM plant. A Tier 1 plant usually serves several at once. */
export interface VehicleProgram {
  id: string;
  customerId: string;          // the key customer (Tier 1) that supplies this programme
  oem: string;                 // "OEM A"
  model: string;               // "K3 compact SUV"
  oemPlant: string;            // where the OEM assembles it, e.g. "Silao, Guanajuato"
  dailyVehicles: number;       // planned vehicles per day
  /** The key customer's own content value per vehicle (seat set or trim it sells), MXN. Estimated; What-if only. */
  revenuePerVehicleMxn?: number;
}

export type SignalKind = "weather" | "road" | "theft" | "port" | "blockade" | "supplier" | "customs";
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
  shortLabel?: string;         // "Open-Meteo forecast"
  sourceId?: string;           // "open-meteo", "demo", "smn"
  active?: boolean;            // false = hidden from the risk engine
}

export type RiskLevel = "green" | "amber" | "red";

/** A recommended action for one supplier in the what-if view. */
export interface ScenarioAction {
  id: string; label: string; detail: string;
  /** Transport co-effect: truck-km multiplier while the action is in place (e.g. 1.15 for a longer alternative route). */
  kmFactor?: number;
}
/** combos: key = one "0"/"1" per action, in `actions` order -> 12 weekly results with those actions in place. */
export interface Scenarios { actions: ScenarioAction[]; combos: Record<string, { level: RiskLevel; extraDays: number; shortDays?: number }[]> }

/** One week of the 12-week outlook. */
export interface OutlookWeek {
  weekStart: string;           // ISO date
  expectedTransitDays: number;
  extraDays: number;           // largest expected delay that week vs normal transit
  level: RiskLevel;
  signals: string[];           // short labels of the signals active that week
}

/** One leg of a supplier's route to the key customer, with its normal and expected (median, next 14 days) time. */
export interface TransitLeg {
  kind: "road" | "border" | "customs" | "port" | "sea";
  label: string;               // "Mexican customs clearance"
  place: string;               // "Nuevo Laredo"
  normalDays: number;
  expectedDays: number;
}

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
  /** Stop day per part (line-stopper and high parts that run out within 14 days). Lets the app say which model stops. */
  partStopDays?: Record<string, number>;
  /** Transit split by route leg (road, border, customs, port). One road leg for a domestic supplier. */
  legs?: TransitLeg[];
  /** 12-week outlook from signals known in advance (estimated; alerts still come from the 14-day projection). */
  outlook?: OutlookWeek[];
  /** What-if: recommended actions and the outlook levels for every combination of them (precomputed by the engine). */
  scenarios?: Scenarios;
  /** Transport footprint of this supplier's deliveries to the key customer (engine, estimated). */
  circular?: TransportFootprint;
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
  resolvedBy?: string;         // 'engine' when the risk turned green on its own
}

/** An email (or dry run) sent about an alert. */
export interface AlertNotification {
  id?: string;
  alertId: string;
  recipient?: string;
  channel?: string;
  status?: string;             // "sent", "dry-run", "failed", …
  dryRun?: boolean;
  sentAt?: string;
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

// ======================= Circular and sustainability layer =======================
// Physical units only (km, trucks, pallets, kg CO2e, tonnes). No money here.

/** Emission factor from the versioned library (readable by everyone). */
export interface EmissionFactor {
  id: string;                  // "ef-road-artic"
  version: number;
  name: string;
  value: number;
  unit: string;                // "kg CO2e/vehicle-km"
  scope: 1 | 2 | 3;
  source: string;
  year: number;
}

/** Transport footprint of one (key customer, supplier) pair, computed by worker/engine/circular.py. */
export interface TransportFootprint {
  roadKm: number;                      // one-way road distance (route legs when known)
  trucksPerWeek: number;
  palletsPerWeek: number;
  fillRate: number;                    // pallets ÷ (trucks × pallets per truck), 0..1
  truckKmPerWeek: number;              // trucks × road km × 2 (round trip)
  co2ePerWeekKg: number;
  expediteKmPerShortDay: number;       // truck-km of expedited freight per line-down day
  expediteCo2ePerShortDayKg: number;
  factorId: string;
  factorVersion: number;
  provenance: Provenance;              // estimated when any part uses the default units per pallet
}

/** One proposed milk run: several suppliers on one truck loop to the key customer. */
export interface ConsolidationLoop {
  id: string;
  members: string[];                   // supplier ids, in pickup order
  trucksBefore: number;                // per week
  trucksAfter: number;
  kmBefore: number;                    // truck-km per week
  kmAfter: number;
  fillBefore: number;                  // average, 0..1
  fillAfter: number;
  co2eBeforeKg: number;                // per week
  co2eAfterKg: number;
  deliveriesPerWeek: number;           // never below any member's current frequency (resilience guard)
  provenance: Provenance;
}

/** Load-consolidation plan for one key customer, from its own demand and supplier locations only. */
export interface ConsolidationPlan {
  customerId: string;
  generatedAt: string;
  loops: ConsolidationLoop[];
  totals: {
    trucksSaved: number; kmSaved: number; co2eSavedKg: number; suppliersInLoops: number;
    excluded: { supplierId: string; reason: string }[];
  };
}

export type ScrapRoute = "recycler" | "mill-return" | "internal-remelt" | "landfill" | "unknown";

/** A supplier's self-reported circular practices for one year. Private to the supplier until shared. */
export interface CircularProfile {
  companyId: string;
  year: number;
  scrapRate?: number;                  // 0..1
  scrapTonnes?: number;
  scrapRoute: ScrapRoute;
  recycledContentPct?: number;         // 0..1
  returnablePackagingPct?: number;     // 0..1
  renewableElectricityPct?: number;    // 0..1
  iso14001: boolean;
  notes?: string;
  provenance: Provenance;              // self-reported = estimated
  updatedAt?: string;
}

/** The frozen summary a supplier shares with one key customer. Never contains costs, prices or margins. */
export type CircularSummary = Omit<CircularProfile, "companyId" | "notes" | "updatedAt">;

export type ShareItem = "circular";
/** A key customer's request to a supplier. */
export interface DataRequest {
  id: string;
  fromCompanyId: string;               // the key customer
  toCompanyId: string;                 // the supplier
  items: ShareItem[];
  fiscalYear: number;
  sentAt: string;
  dueDate: string;
  status: "open" | "in-review" | "answered";
  note?: string;
}

/** What a supplier has explicitly shared with one key customer. Payload frozen at approval; revocable. */
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
  circular?: CircularSummary;
}
