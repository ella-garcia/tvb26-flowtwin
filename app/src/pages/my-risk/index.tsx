// My risk: what the supplier's customers see about it, plus alerts and ways to improve the score.
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { useScoped } from "../../lib/useScoped";
import type { Alert, RiskAssessment } from "../../lib/types";
import { Button, FilterChip, Icon, StatusPill, type IconName } from "../../keystone";
import { AlertStatusPill, Card, Empty, PageHeader, RiskLight, ScopedError } from "../../components/shared";
import { date } from "../../lib/format";
import SupplierRiskView from "../supplier/SupplierRiskView";
import "./my-risk.css";

function AlertCard({ alert, customerName }: { alert: Alert; customerName: string }) {
  const { db, dispatch } = useApp();
  const [message, setMessage] = useState("");
  const [capacity, setCapacity] = useState(false);
  const unanswered = alert.status === "new" || alert.status === "acknowledged";
  const by = db.company(db.viewer.companyId)?.contact?.name ?? db.viewer.role;

  return (
    <div className="my-risk-alert">
      <div className="my-risk-alert-head">
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <RiskLight level={alert.level} />
          <h3>{alert.title}</h3>
        </div>
        <AlertStatusPill status={alert.status} audience="supplier" />
      </div>
      <p>{alert.message}</p>
      <p className="ft-muted" style={{ fontSize: 12 }}>
        From {customerName}, {date(alert.createdAt)}
        {alert.expectedShortfallDate && <> · Stock could run short on {date(alert.expectedShortfallDate)}</>}
      </p>
      {alert.supplierResponse && (
        <div className="my-risk-sent">
          <strong>Your response</strong>
          <span>{alert.supplierResponse.message || "No message."}</span>
          <StatusPill tone={alert.supplierResponse.confirmedCapacity ? "success" : "warning"}>
            {alert.supplierResponse.confirmedCapacity ? "Capacity confirmed" : "Capacity not confirmed"}
          </StatusPill>
          <small>Sent by {alert.supplierResponse.by} on {date(alert.supplierResponse.at)}</small>
        </div>
      )}
      {unanswered && (
        <div className="my-risk-form">
          <label className="my-risk-lbl" htmlFor={`msg-${alert.id}`}>Message to {customerName}</label>
          <textarea id={`msg-${alert.id}`} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell them what you can do, for example an earlier truck or extra stock." />
          <label className="my-risk-check">
            <input type="checkbox" checked={capacity} onChange={(e) => setCapacity(e.target.checked)} />
            We can cover the next deliveries as planned
          </label>
          <div><Button size="sm" icon="check" onClick={() =>
            dispatch({ type: "respond-alert", id: alert.id, response: { by, at: db.asOf, message: message.trim(), confirmedCapacity: capacity } })
          }>Send response</Button></div>
        </div>
      )}
    </div>
  );
}

function improvements(r: RiskAssessment | undefined): { icon: IconName; text: string }[] {
  if (!r) return [];
  const out: { icon: IconName; text: string }[] = [];
  if (r.dataStatus !== "connected") {
    out.push({ icon: "upload", text: r.dataStatus === "invited"
      ? "Connect your data. Your score uses public information only until you finish the steps in My data."
      : "Connect your data. Right now the score relies on public information, so it is cautious about you." });
  }
  if (!r.flex.canAbsorb) out.push({ icon: "gear", text: `Confirm press capacity. Today ${r.flex.bottleneck} limits an extra ${Math.round(r.flex.demandIncrease * 100)}% of orders.` });
  if (r.drivers.some((d) => d.kind === "road" || d.kind === "weather" || d.kind === "port" || d.kind === "blockade")) {
    out.push({ icon: "truck", text: "Add a daytime departure window and a backup route, so trucks can avoid the affected highways." });
  }
  if (r.drivers.some((d) => d.kind === "theft")) out.push({ icon: "lock", text: "Move night departures to daytime windows where you can. Fewer night trips lowers theft risk." });
  if (r.minCoverDays < 5) out.push({ icon: "cube", text: `Raise stock at your customer. The lowest cover is ${r.minCoverDays.toFixed(1)} days; a few extra pallets help.` });
  if (r.drivers.some((d) => d.kind === "history")) out.push({ icon: "check", text: "Recover on-time delivery. A few clean weeks bring the score down quickly." });
  if (!out.length) out.push({ icon: "check", text: "Keep your data up to date. Nothing else is needed right now." });
  return out;
}

export default function MyRiskPage() {
  const { db, go } = useApp();
  const [picked, setPicked] = useState<string | null>(null);
  const supplierId = db.viewer.companyId;

  const read = useScoped(() => ({
    risks: db.risks().filter((r) => r.supplierId === supplierId),
    alerts: db.alerts().filter((a) => a.supplierId === supplierId),
  }), [db, supplierId]);

  if (!read.ok) return <ScopedError title="What your customers see" error={read.error} />;
  const { risks, alerts } = read.data;
  const customerIds = Array.from(new Set(risks.map((r) => r.customerId)));
  const customerId = picked && customerIds.includes(picked) ? picked : customerIds[0];
  const nameOf = (id: string) => db.company(id)?.name ?? id;
  const risk = risks.find((r) => r.customerId === customerId);
  const shownAlerts = alerts.filter((a) => !customerId || a.customerId === customerId);

  return (
    <div className="my-risk-stack">
      <PageHeader title="What your customers see"
        caption="Your customers see this risk view about you. They never see your costs, prices or margins."
        actions={customerIds.length > 0 && risk && <RiskLight level={risk.level} />} />
      {customerIds.length > 1 && (
        <div className="my-risk-chips" role="group" aria-label="Customer">
          {customerIds.map((id) => <FilterChip key={id} pressed={id === customerId} onClick={() => setPicked(id)}>{nameOf(id)}</FilterChip>)}
        </div>
      )}
      <Card title="Alerts about you">
        {shownAlerts.length === 0
          ? <p className="ft-muted" style={{ margin: 0 }}>No alerts about you right now.</p>
          : <div className="my-risk-stack" style={{ gap: "var(--space-4)" }}>
              {shownAlerts.map((a) => <AlertCard key={a.id} alert={a} customerName={nameOf(a.customerId)} />)}
            </div>}
      </Card>
      {customerId
        ? <SupplierRiskView customerId={customerId} supplierId={supplierId} audience="supplier" />
        : <Empty title="No customer sees you yet" action={<Button variant="secondary" onClick={() => go("data")}>Open your data</Button>}>
            When a customer adds you to FlowTwin, the risk view they see appears here.
          </Empty>}
      {risk && (
        <Card title="Improve your score">
          <ul className="my-risk-actions">
            {improvements(risk).map((a, i) => <li key={i}><Icon name={a.icon} />{a.text}</li>)}
          </ul>
          <p className="ft-muted" style={{ margin: 0, fontSize: 12 }}>
            Score {risk.score} of 100, higher means riskier. Updated {date(risk.updatedAt)}.
          </p>
        </Card>
      )}
    </div>
  );
}
