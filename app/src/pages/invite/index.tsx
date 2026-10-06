import { useState, type FormEvent } from "react";
import { useApp } from "../../app/AppContext";
import { useScoped } from "../../lib/useScoped";
import { Card, PageHeader, ScopedError } from "../../components/shared";
import { Button, DataTable, Icon, StatusPill, type Column } from "../../keystone";
import { date, pct, rowNo } from "../../lib/format";
import "./invite.css";

const shared = (swing: string) => ["Risk light and the reasons behind it", "Parts you buy from them, and your stock of those parts", `Result of the +${swing} demand test`, "Delivery performance (OTIF)"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface Row { id: string; name: string; contact: string; status: "Invited" | "Joined"; when?: string }

export default function InvitePage() {
  const { db, dispatch, toggles } = useApp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const read = useScoped(() => ({
    invites: db.invites(),
    risks: db.risks().filter((r) => r.customerId === toggles.companyId),
    customerName: db.company(toggles.companyId)?.name ?? "your company",
    swing: pct(db.settings().contractDemandSwing, 0),
  }), [db, toggles.companyId]);
  if (!read.ok) return <ScopedError title="Invite suppliers" error={read.error} />;
  const { invites, risks, customerName, swing } = read.data;

  const connected: Row[] = risks.filter((r) => r.dataStatus === "connected").map((r) => ({
    id: `c-${r.supplierId}`, name: db.company(r.supplierId)?.name ?? r.supplierId, contact: "On the platform", status: "Joined" as const, when: r.updatedAt,
  }));
  const joinedIds = new Set(risks.filter((r) => r.dataStatus === "connected").map((r) => r.supplierId));
  const invited: Row[] = invites.filter((i) => !(i.supplierId && joinedIds.has(i.supplierId))).map((i) => ({
    id: i.id, name: i.supplierName, contact: i.contactEmail, status: i.status === "joined" ? "Joined" as const : "Invited" as const, when: i.sentAt,
  }));
  const rows = [...invited.sort((a, b) => (b.when ?? "").localeCompare(a.when ?? "")), ...connected];

  const cols: Column<Row>[] = [
    { key: "no", label: "No", render: (_r, i) => rowNo(i) },
    { key: "name", label: "Supplier", render: (r) => <strong>{r.name}</strong> },
    { key: "contact", label: "Contact" },
    { key: "when", label: "Date", render: (r) => (r.when ? date(r.when) : "") },
    { key: "status", label: "Status", render: (r) => <StatusPill tone={r.status === "Joined" ? "success" : "warning"}>{r.status}</StatusPill> },
  ];

  const emailOk = EMAIL_RE.test(email.trim());
  const nameOk = name.trim().length > 1;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!emailOk || !nameOk) return;
    const existing = db.companies().find((c) => c.kind === "supplier" && c.name.toLowerCase() === name.trim().toLowerCase());
    dispatch({ type: "send-invite", invite: {
      id: `inv-${Date.now()}`, customerId: toggles.companyId, supplierId: existing?.id, supplierName: name.trim(),
      contactEmail: email.trim(), sentAt: db.asOf, status: "sent", plan: "sponsored",
    } });
    setSent(name.trim());
    setName(""); setEmail(""); setTouched(false);
  };

  return (
    <div className="invite-stack">
      <PageHeader title="Invite suppliers" caption={`Your suppliers join free. Their account is sponsored by ${customerName}.`} />

      <div className="invite-two">
        <Card title="Send an invitation">
          <form className="invite-form" onSubmit={submit} noValidate>
            <label className="invite-field">Supplier company name
              <input className="ft-control" value={name} onChange={(e) => { setName(e.target.value); setSent(null); }} autoComplete="off"
                aria-invalid={touched && !nameOk} aria-describedby={touched && !nameOk ? "inv-name-err" : undefined} />
              {touched && !nameOk && <p id="inv-name-err" className="invite-error">Enter the supplier's company name.</p>}
            </label>
            <label className="invite-field">Contact email
              <input className="ft-control" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSent(null); }} autoComplete="off"
                aria-invalid={touched && !emailOk} aria-describedby={touched && !emailOk ? "inv-mail-err" : undefined} />
              {touched && !emailOk && <p id="inv-mail-err" className="invite-error">Enter a valid email address, like name@company.mx.</p>}
            </label>
            <fieldset className="invite-fieldset">
              <legend>What the supplier will share with you</legend>
              {shared(swing).map((s) => (
                <label key={s} className="invite-check"><input type="checkbox" checked readOnly disabled />{s}</label>
              ))}
              <div className="invite-never"><Icon name="lock" size={18} />Never shared: costs, prices and margins</div>
            </fieldset>
            <div><Button type="submit" variant="primary" icon="share">Send invitation</Button></div>
            {sent && (
              <div className="invite-ok" role="status"><Icon name="check" /><div>Invitation recorded for {sent}. In v0 no email is sent.</div></div>
            )}
          </form>
        </Card>

        <Card title="What your supplier gets">
          <ul className="invite-gets">
            <li><Icon name="pulse" /><span><strong>Their own risk light</strong>The same light and reasons you see, so there are no surprises.</span></li>
            <li><Icon name="bell" /><span><strong>Alerts about them</strong>Early warning when weather, roads or stock put deliveries at risk.</span></li>
            <li><Icon name="cube" /><span><strong>A free twin of their network</strong>They upload their own data and test changes. Their costs stay private.</span></li>
          </ul>
        </Card>
      </div>

      <Card title="Suppliers">
        {rows.length === 0 ? <p className="invite-note">No suppliers invited yet. Send your first invitation above.</p> : (
          <DataTable<Row> caption="Invited and connected suppliers" columns={cols} rows={rows} />
        )}
      </Card>
    </div>
  );
}
