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
/** Key customer (Tier 1) intake kinds, parsed by the worker (worker/intake). */
export type Tier1UploadKind = "tier1-suppliers" | "tier1-parts" | "tier1-stock" | "tier1-releases" | "tier1-receipts";
export interface UploadRecord {
  companyId: string;
  kind: UploadKind | Tier1UploadKind;
  fileName: string;
  rows: number;
  source: string;             // "Excel", "CSV", "EDI", "ERP", "CFDI", "CONTPAQi export", …
  status: "waiting" | "processing" | "uploaded" | "needs-input" | "failed";
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
  /** Country of origin, ISO 3166-1 alpha-2 ("MX", "CN"). Absent = not known. Feeds the trade-exposure driver. */
  originCountry?: string;
  /** Tariff code (fracción arancelaria), digits only. Absent = not known. */
  hsCode?: string;
  /** Where the stock figure came from ("upload", "edi", "erp", "seed") and which file or run. */
  stockSource?: string;
  stockSourceRef?: string;
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

export type SignalKind = "weather" | "road" | "theft" | "port" | "blockade" | "supplier" | "customs"
  | "policy"            // tariff, USMCA or customs-rule event; affects parts by origin country / HS code, not transit
  | "supplier-input";   // shortage of a supplier's own inputs (chips, steel …); cuts what it can deliver
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
  /** supplier-input only: share of the supplier's deliveries it cannot make while active, 0..1. */
  supplyCutPct?: number;
  /** Who the signal reaches when not by place or highway (policy and supplier-input signals). */
  affects?: { supplierIds?: string[]; originCountries?: string[]; hsPrefixes?: string[] };
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
  confidence?: "high" | "medium" | "low"; // high up to day 3, medium up to day 7, low after (weather bands widen too)
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

/** An email or WhatsApp message (or dry run) sent about an alert. */
export interface AlertNotification {
  id?: string;
  alertId: string;
  recipient?: string;
  channel?: string;            // "email" | "whatsapp"
  status?: string;             // "sent", "dry-run", "failed", …
  dryRun?: boolean;
  sentAt?: string;
  template?: string;           // WhatsApp template name
  deliveredAt?: string;        // WhatsApp delivery receipt
  readAt?: string;             // WhatsApp read receipt
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

// ======================= Phase 2: live data, alerts and track record =======================
// Mirrors supabase/migrations/20261014000000_phase2_foundation.sql. No money fields anywhere below.

export type IntakeSource = "upload" | "edi" | "erp" | "cfdi" | "reply";

/** What a supplier says it shipped (EDI 856/DESADV, CFDI, ERP, reply page). Quantities and dates only. */
export interface ShipmentNotice {
  id: number;
  customerId: string;
  supplierId: string;
  partId: string;
  quantity: number;
  shipDate?: string;
  expectedArrival?: string;
  carrier?: string;
  source: Exclude<IntakeSource, "upload"> | "upload";
  sourceRef: string;           // interchange control number, CFDI UUID, ERP document id …
  confidence?: number;         // 0..1; below 1 when read from free text
  createdAt: string;
}

/** A capacity change a supplier reports (maintenance, extra shift). Private to the supplier; the customer sees only the flex result. */
export interface CapacityEvent {
  id: number;
  supplierId: string;
  resource?: string;           // "Prensa 3"
  startsOn: string;
  endsOn?: string;
  capacityChangePct: number;   // -0.3 = 30% less, 0.2 = 20% more
  reason?: string;
  source: "supplier" | "reply" | "erp";
  createdAt: string;
}

/** A person who gets alerts. Phone numbers are visible only to their own company. */
export interface Contact {
  id: string;
  companyId: string;
  name?: string;
  role?: string;
  email?: string;
  phoneE164?: string;          // "+524611234567"
  locale: "es" | "en";
  whatsappOptInAt?: string;
  whatsappOptInText?: string;  // the exact wording agreed to
  whatsappOptOutAt?: string;
  isPrimary: boolean;
  updatedAt: string;
}

/** A contact as the key customer sees it at one of its suppliers: who, and on which channels. Never the phone number. */
export interface PairContact {
  id: string;
  companyId: string;
  name?: string;
  role?: string;
  hasEmail: boolean;
  hasWhatsapp: boolean;
}

/** One day's risk for a pair, kept so predictions can be checked against what happened. */
export interface RiskHistoryRow {
  customerId: string;
  supplierId: string;
  asOf: string;
  level: RiskLevel;
  score: number;
  daysToLineStop?: number;
  partStopDays?: Record<string, number | null>;
  projection?: ProjectionDay[];
  drivers?: RiskDriver[];
}

export type AlertOutcomeKind = "pending" | "hit" | "prevented" | "miss" | "false-alarm" | "unknown";
/** Whether an alert's prediction came true, judged from receipts and shipment notices. */
export interface AlertOutcome {
  alertId: string;
  predictedStopDate?: string;
  partIds: string[];
  outcome: AlertOutcomeKind;
  evidence: { kind: "receipt" | "shipment-notice" | "action"; ref: string; date?: string; note?: string }[];
  ruleVersion?: string;
  evaluatedAt?: string;
}

/** One goods-receipt line at the key customer (mirrors public.receipts). Quantities in the part's own unit; no amounts. */
export interface Receipt {
  id?: number;
  customerId: string;
  supplierId: string;
  partId?: string;             // absent when the line could not be matched to a part
  poNumber: string;
  promisedDate: string;
  receivedDate?: string;       // absent = not received yet
  quantityOrdered: number;
  quantityReceived: number;
  source?: IntakeSource;
  sourceRef?: string;
}

/** A delivery problem nobody warned about: a late or short receipt (or stock-out) with no alert in the 3 days before. */
export interface MissedEvent {
  customerId: string;
  supplierId: string;
  partId: string;
  eventDate: string;
  evidence: AlertOutcome["evidence"];
  ruleVersion?: string;
  detectedAt?: string;
}

/** A data connection (EDI inbox, ERP, CFDI provider). Secrets are never in the app. */
export interface Connection {
  id: string;
  companyId: string;
  kind: "edi" | "erp" | "cfdi";
  provider: string;            // "edi-inbox", "sap-s4", "syntage"
  status: "pending" | "active" | "paused" | "error";
  config: Record<string, unknown>;
  consentText?: string;
  consentAt?: string;
  lastRunAt?: string;
  createdAt: string;
}

export interface IntegrationRun {
  id: number;
  connectionId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "done" | "failed";
  rows: number;
  issues: { row: number; column: string; message: string; severity: "error" | "warning" | "info" }[];
  error?: string;
}

/** What the mobile reply page shows for one signed link (WP6): one alert or a weekly check-in, supplier-safe fields only. */
export interface ReplyContext {
  kind: "alert" | "checkin";
  supplierName: string;
  customerName: string;
  alertId?: string;
  title?: string;
  message?: string;
  parts: { number: string; name: string }[];
  expectedShortfallDate?: string;
  expiresAt: string;
  answered: boolean;
}
