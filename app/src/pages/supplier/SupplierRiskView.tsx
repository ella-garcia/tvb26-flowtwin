// Supplier risk detail, shared by the key customer (audience "customer") and the supplier's own
// "My risk" page (audience "supplier": "this is exactly what your customer sees").
import { useApp } from "../../app/AppContext";
import { AccessDeniedError } from "../../lib/dataLayer";
import { AlertStatusPill, Card, CritPill, DataStatusPill, Empty, FlexPill, FormulaSource, GradePill, NotShared, OtifDelta, ProvenanceTag, RiskLight } from "../../components/shared";
import { DataTable, Icon, StatusPill, type Column } from "../../keystone";
import { date, days, mxn, num, pct, rowNo } from "../../lib/format";
import { DEFAULT_OTIF_TARGET, otifSummary } from "../../lib/otif";
import { CRIT_RANK, partStock } from "../../lib/stock";
import { programsOf } from "../../lib/programs";
import { segmentLabel } from "../../packs";
import type { Alert, ChainPosition, Part, ProjectionDay, RiskAssessment, Signal, VehicleProgram } from "../../lib/types";
import "./supplier.css";

export interface SupplierRiskViewProps { customerId: string; supplierId: string; audience: "customer" | "supplier" }



function headline(r: RiskAssessment, parts: Part[]): { text: string; tone: "danger" | "ok" | "plain" } {
  if (r.daysToLineStop == null) return { text: "No line stop expected in the next 14 days", tone: "ok" };
  const worst = [...parts].sort((a, b) => a.daysOfCover - b.daysOfCover).find((p) => p.criticality === "line-stopper") ?? [...parts].sort((a, b) => a.daysOfCover - b.daysOfCover)[0];
  const d = r.daysToLineStop;
  const when = d <= 0 ? "today" : `in ${days(d)}`;
  return { text: worst ? `If nothing changes, your line runs out of ${worst.number} ${when}` : `If nothing changes, your line may stop ${when}`, tone: "danger" };
}

// ---------- Projection chart ----------
function ProjectionChart({ proj, normal }: { proj: ProjectionDay[]; normal: number }) {
  const W = 720, H = 300, L = 44, R = 16, T = 16, B = 40;
  const n = proj.length;
  const maxY = Math.max(1, ...proj.flatMap((p) => [p.transitP90, p.coverDays, p.transitP50]), normal);
  const top = Math.ceil(maxY + 0.5);
  const x = (i: number) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = (f: (p: ProjectionDay) => number) => proj.map((p, i) => `${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(" ");
  const band = [...proj.map((p, i) => `${x(i).toFixed(1)},${y(p.transitP90).toFixed(1)}`),
    ...[...proj].reverse().map((p, i) => `${x(n - 1 - i).toFixed(1)},${y(p.transitP10).toFixed(1)}`)].join(" ");
  const cross = proj.findIndex((p) => p.coverDays < p.transitP50);
  const step = Math.max(1, Math.ceil(top / 6));
  const ticks: number[] = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const short = (iso: string) => date(iso).replace(/ \d{4}$/, "");
  const xl = proj.map((_, i) => i).filter((i) => i % 2 === 0 || i === n - 1);
  const summary = cross >= 0
    ? `From ${date(proj[cross].date)}, your stock runs out before the next delivery can arrive.`
    : "Days of cover stay above the expected transit time for the next 14 days.";
  return (
    <svg className="supplier-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Twin projection, next 14 days. ${summary}`}>
      {ticks.map((v) => (
        <g key={v}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>
      ))}
      <line className="axis" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      <text x={12} y={T + 4} textAnchor="start">days</text>
      {xl.map((i) => <text key={i} x={x(i)} y={H - B + 18} textAnchor="middle">{short(proj[i].date)}</text>)}
      <polygon points={band} fill="var(--projection)" opacity={0.25} />
      <line x1={L} x2={W - R} y1={y(normal)} y2={y(normal)} stroke="var(--ink-subtle)" strokeWidth={2} strokeDasharray="6 5" />
      <polyline points={line((p) => p.transitP50)} fill="none" stroke="var(--projection)" strokeWidth={2.5} strokeLinejoin="round" />
      <polyline points={line((p) => p.coverDays)} fill="none" stroke="var(--cover)" strokeWidth={2.5} strokeLinejoin="round" />
      {cross >= 0 && (
        <g>
          <line x1={x(cross)} x2={x(cross)} y1={T} y2={y(0)} stroke="var(--danger)" strokeWidth={1.5} strokeDasharray="2 3" />
          <circle cx={x(cross)} cy={y(proj[cross].coverDays)} r={6} fill="var(--surface-raised)" stroke="var(--danger)" strokeWidth={2.5} />
          <text x={Math.min(x(cross) + 8, W - 110)} y={T + 12} style={{ fill: "var(--danger)", fontWeight: 700 }}>Next delivery too late</text>
        </g>
      )}
    </svg>
  );
}

function Legend() {
  return (
    <ul className="supplier-legend">
      <li><svg width="28" height="12" aria-hidden="true"><rect x="0" y="1" width="28" height="10" fill="var(--projection)" opacity="0.25" /></svg>Transit time, likely range (P10 to P90)</li>
      <li><svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke="var(--projection)" strokeWidth="2.5" /></svg>Expected transit (P50)</li>
      <li><svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke="var(--cover)" strokeWidth="2.5" /></svg>Days of cover in your stock</li>
      <li><svg width="28" height="12" aria-hidden="true"><line x1="0" x2="28" y1="6" y2="6" stroke="var(--ink-subtle)" strokeWidth="2" strokeDasharray="6 5" /></svg>Normal transit</li>
      <li><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--danger)" strokeWidth="2.5" /></svg>Next delivery too late: your cover runs out before it arrives</li>
    </ul>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const W = 220, H = 56, p = 6;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 0.01;
  const pts = values.map((v, i) => [p + (i / Math.max(1, values.length - 1)) * (W - 2 * p), H - p - ((v - lo) / span) * (H - 2 * p)]);
  const last = pts[pts.length - 1];
  return (
    <svg className="supplier-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`On-time in-full over the last ${values.length} weeks, from ${pct(values[0])} to ${pct(values[values.length - 1])}`}>
      <polyline points={pts.map((q) => q.join(",")).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r={3.5} />
    </svg>
  );
}

export function SupplierRiskView({ customerId, supplierId, audience }: SupplierRiskViewProps) {
  const { db, pack, go } = useApp();
  let risk: RiskAssessment | undefined;
  let parts: Part[] = [], alerts: Alert[] = [], signals: Signal[] = [], programs: VehicleProgram[] = [];
  let supplierName = "", place = "", customerName = "your customer", chain: ChainPosition = "sub", otifTarget = DEFAULT_OTIF_TARGET;
  let sizeBand: Parameters<typeof segmentLabel>[2] = "medium";
  try {
    risk = db.risk(customerId, supplierId);
    parts = db.parts().filter((p) => p.supplierId === supplierId && p.customerId === customerId);
    alerts = db.alerts().filter((a) => a.supplierId === supplierId && a.customerId === customerId);
    signals = db.signals();
    programs = db.programs();
    const s = db.company(supplierId);
    supplierName = s?.name ?? supplierId;
    place = s ? `${s.city}, ${s.state}` : "";
    sizeBand = s?.sizeBand ?? "medium";
    customerName = db.company(customerId)?.name ?? "your customer";
    try {
      const rel = audience === "customer"
        ? db.suppliersOf(customerId).find((x) => x.company.id === supplierId)
        : db.customersOf(supplierId).find((x) => x.customerId === customerId);
      if (rel) { chain = rel.chainPosition; otifTarget = rel.requirements.otifTarget; }
    } catch { /* keep default */ }
  } catch (e) {
    if (e instanceof AccessDeniedError) return <NotShared message={e.message} />;
    throw e;
  }
  if (!risk) {
    return <Empty title="No risk assessment yet" action={audience === "customer" ? <button type="button" className="ft-linkbtn" onClick={() => go("risk")}>Back to the risk board</button> : undefined}>
      {supplierName ? `There is no risk assessment for ${supplierName} yet.` : "There is no risk assessment for this supplier yet."}
    </Empty>;
  }

  const status = { prov: risk.dataStatus === "connected" ? "measured" as const : "estimated" as const };
  const head = headline(risk, parts);
  const sortedParts = [...parts].sort((a, b) => CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality] || a.daysOfCover - b.daysOfCover);
  const sigOf = (id?: string) => (id ? signals.find((s) => s.id === id) : undefined);
  const drivers = [...risk.drivers].sort((a, b) => b.contribution - a.contribution);
  const f = risk.flex;
  const otif = risk.otifTrend;
  const otifNow = otif.length ? otif[otif.length - 1] : undefined;
  const record = otifSummary(otif, otifTarget);
  // Same comparison as the risk board and the score: last 4 weeks vs first 4 weeks.
  const otifDelta = record?.change;
  const privacy = audience === "supplier"
    ? <>This is exactly what <strong>{customerName}</strong> sees: risk light, drivers, parts and stock, flex test, delivery performance. Never shared: costs, prices and margins.</>
    : <>Shared with <strong>{customerName}</strong>: risk light, drivers, parts and stock, flex test, delivery performance. <strong>Never shared:</strong> costs, prices and margins.</>;

  const cols: Column<Part>[] = [
    { key: "no", label: "No", render: (_p, i) => rowNo(i) },
    { key: "number", label: "Part number", render: (p) => <span className="supplier-part-name">{p.number}</span> },
    { key: "name", label: "Name" },
    { key: "criticality", label: "Criticality", render: (p) => <CritPill c={p.criticality} /> },
    { key: "models", label: "Models", render: (p) => {
      const ms = programsOf([p], programs);
      return ms.length ? ms.map((g) => g.model).join(", ") : <span className="supplier-muted">Not mapped</span>;
    } },
    { key: "singleSource", label: "Single source", render: (p) => (p.singleSource ? "Yes" : "No") },
    { key: "dailyUsage", label: "Daily usage", numeric: true, align: "right", render: (p) => num(p.dailyUsage) },
    { key: "onHand", label: "On hand", numeric: true, align: "right", render: (p) => num(p.onHand) },
    { key: "daysOfCover", label: "Days of cover", numeric: true, align: "right", render: (p) => num(p.daysOfCover, 1) },
    { key: "inTransit", label: "On the road", numeric: true, align: "right", render: (p) => p.inTransit == null ? <span className="supplier-muted">Unknown</span> : num(p.inTransit) },
    { key: "supplierFg", label: "At supplier", numeric: true, align: "right", render: (p) => p.supplierFgOnHand == null ? <span className="supplier-muted">Not shared</span> : num(p.supplierFgOnHand) },
    { key: "next", label: "Next delivery", render: (p) => {
      const st = partStock(p, risk, db.asOf);
      if (!st.nextDeliveryDate) return <span className="supplier-muted">No estimate</span>;
      return (
        <span className="supplier-next">
          <span className="ks-num">{date(st.nextDeliveryDate)}</span>
          {st.status === "short" && <StatusPill tone="danger">Runs out first</StatusPill>}
          {st.status === "tight" && <StatusPill tone="warning">Tight</StatusPill>}
          {st.nextDeliveryEstimated && <ProvenanceTag provenance="estimated" />}
        </span>
      );
    } },
    { key: "unitCostMxn", label: "Unit cost", numeric: true, align: "right", render: (p) => mxn(p.unitCostMxn) },
  ];

  return (
    <div className="supplier-stack">
      <div className="supplier-head">
        <div className="supplier-head-top">
          <h1 className="ft-title">{supplierName}</h1>
          <RiskLight level={risk.level} />
        </div>
        <div className="supplier-meta">
          {place && <span>{place}</span>}
          <span>{segmentLabel(pack, chain, sizeBand)}</span>
          <span className="supplier-score ks-num">Score {num(risk.score)} of 100</span>
          <DataStatusPill status={risk.dataStatus} />
          <span>Updated {date(risk.updatedAt)}</span>
        </div>
        <p className={`supplier-headline ${head.tone === "danger" ? "supplier-headline-danger" : head.tone === "ok" ? "supplier-headline-ok" : ""}`}>{head.text}</p>
      </div>

      <Card title="Why this colour">
        {drivers.length === 0 ? <p className="supplier-note">No risk drivers are active right now.</p> : (
          <ul className="supplier-drivers">
            {drivers.map((d, i) => {
              const sig = sigOf(d.signalId);
              return (
                <li key={i} className="supplier-driver">
                  <div>
                    <span className="supplier-driver-label">{d.label}</span>
                    {sig && <span className="supplier-driver-src">{sig.title} · Source: {sig.source}</span>}
                  </div>
                  <div className="supplier-bar" role="img" aria-label={`${d.contribution} points out of 100`}><i style={{ width: `${Math.max(0, Math.min(100, d.contribution))}%` }} /></div>
                  <span className="supplier-driver-pts ks-num">{num(d.contribution, d.contribution % 1 ? 1 : 0)} pts</span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="supplier-note">Bars are drawn on a 0 to 100 scale. Together the drivers make the score of {num(risk.score)}.</p>
      </Card>

      <Card title="Twin projection, next 14 days" actions={<ProvenanceTag provenance={status.prov} />}>
        {risk.projection.length > 1 ? (
          <>
            <ProjectionChart proj={risk.projection} normal={risk.normalTransitDays} />
            <Legend />
          </>
        ) : <p className="supplier-note">No projection is available yet.</p>}
        <p className="supplier-note ks-num">Normal transit {num(risk.normalTransitDays, 1)} days · expected {num(risk.expectedTransitDays, 1)} days · worst case {num(risk.worstCaseTransitDays, 1)} days · lowest cover {num(risk.minCoverDays, 1)} days</p>
        <FormulaSource
          formula="Monte Carlo of transit time with the active signals applied; line stop risk starts on the first day cover is below expected transit (P50)."
          data={`Active signals on the lane, normal transit of ${num(risk.normalTransitDays, 1)} days, and ${customerName}'s stock and daily usage.`}
          provenance={status.prov} />
      </Card>

      <Card title="Can they absorb a +15% demand change?" actions={<ProvenanceTag provenance={f.provenance} />}>
        <div className="supplier-flex">
          <div className="supplier-flex-verdict">
            <span className="supplier-flex-word">{f.canAbsorb ? "Yes" : "No"}</span>
            <FlexPill flex={f} />
          </div>
          <dl className="supplier-facts">
            <dt>Service level under surge</dt><dd className="ks-num">{pct(f.serviceLevel, 0)}</dd>
            <dt>Days to recover</dt><dd className="ks-num">{f.daysToRecover == null ? "Not needed" : days(f.daysToRecover)}</dd>
            <dt>Headroom before the surge</dt><dd className="ks-num">{pct(f.headroom, 0)}</dd>
            <dt>Bottleneck</dt><dd>{f.bottleneck}</dd>
          </dl>
          <p className="supplier-note">Contracts allow demand changes of ±15%, so this is tested for +{pct(f.demandIncrease, 0)}.</p>
          <FormulaSource formula="Twin run with demand raised by the contract swing; service level = units delivered on time ÷ units ordered."
            data="Supplier capacity, shifts and material supply in the twin." provenance={f.provenance} />
        </div>
      </Card>

      <Card title="Parts">
        {sortedParts.length === 0 ? <p className="supplier-note">No parts are shared for this supplier yet.</p> : (
          <DataTable<Part> caption="Parts from this supplier" columns={cols} rows={sortedParts} />
        )}
        <p className="supplier-note">Ranked by line-stop risk, not by value. A MX$2 clip can stop a line.
          {audience === "customer" && <> <button type="button" className="ft-linkbtn" onClick={() => go("parts", supplierId)}>See these parts on Parts &amp; stock</button></>}</p>
      </Card>

      <Card title="Delivery performance (OTIF, 12 weeks)">
        {otif.length < 2 ? <p className="supplier-note">Not enough weeks of delivery data yet.</p> : (
          <div className="supplier-otif">
            <Sparkline values={otif} />
            <div>
              <div className="supplier-otif-value ks-num">{pct(otifNow!)}</div>
              {otifDelta != null && <div><OtifDelta change={otifDelta} long /></div>}
            </div>
            {record && (
              <div className="supplier-grade">
                <GradePill grade={record.grade} />
                <span className="supplier-note ks-num">12-week average {pct(record.average)} · target {pct(record.target, 0)}</span>
              </div>
            )}
          </div>
        )}
        <FormulaSource formula="Order lines delivered on time and in full ÷ all order lines, per week. Delivery record: 12-week average against the contract OTIF target; A at or above target, B up to 3 points below, C further below. Kept separate from the risk light, which looks forward." data="Delivery records shared by the supplier." provenance={status.prov} />
      </Card>

      {audience === "customer" && (
        <Card title="Related alerts" actions={<button type="button" className="ft-linkbtn" onClick={() => go("alerts")}>View all alerts</button>}>
          {alerts.length === 0 ? <p className="supplier-note">No alerts for this supplier.</p> : (
            <ul className="supplier-alerts">
              {alerts.map((a) => (
                <li key={a.id}>
                  <span>{a.title}</span>
                  <AlertStatusPill status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <div className="supplier-privacy"><Icon name="lock" /><p style={{ margin: 0 }}>{privacy}</p></div>
      </Card>
    </div>
  );
}

export default SupplierRiskView;
