// Key customer, Data page: which systems each supplier has connected, and a way to ask a supplier to connect.
// The supplier sees the request on its own Data page; asking for any system there answers it.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../app/AppContext";
import { Button, DataTable, StatusPill, type Column } from "../../keystone";
import { Card } from "../shared";
import { date } from "../../lib/format";
import * as remote from "../../lib/remote";
import { scoped } from "../../lib/useScoped";
import type { Company, Connection, DataRequest } from "../../lib/types";
import { integrationState, PROVIDERS, SYSTEMS, type Provider } from "./providers";
import "./integrations.css";

interface Row {
  id: string;
  company: Company;
  connected: Provider[];
  pending: Provider[];
  request?: DataRequest;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function SupplierSystemsCard({ customerId }: { customerId: string }) {
  const { db, dispatch, mode } = useApp();
  const live = mode === "live";
  const sup = scoped(() => db.suppliersOf(customerId));
  const suppliers = useMemo(() => (sup.ok ? sup.data.map((s) => s.company) : []), [sup]);
  const ids = suppliers.map((c) => c.id).sort().join(",");
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    if (!live || !ids) return;
    let cancelled = false;
    remote.fetchPairConnections(ids.split(",")).then(
      (rows) => { if (!cancelled) setConnections(rows); },
      () => { if (!cancelled) setConnections([]); },
    );
    return () => { cancelled = true; };
  }, [live, ids]);

  if (!sup.ok || suppliers.length === 0) return null;
  const requests = db.requests().filter((r) => r.items.includes("connect-systems"));
  const rows: Row[] = suppliers.map((c) => {
    const own = connections.filter((x) => x.companyId === c.id);
    const st = (p: Provider) => integrationState(p.id, { companyId: c.id, synthetic: c.synthetic, connections: own, requested: new Set(), kind: c.kind }).status;
    const systems = PROVIDERS.filter((p) => SYSTEMS.includes(p.id));
    const mine = requests.filter((r) => r.toCompanyId === c.id).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    return { id: c.id, company: c, connected: systems.filter((p) => st(p) === "connected"), pending: systems.filter((p) => st(p) === "requested"),
      request: mine.find((r) => r.status === "open") ?? mine[0] };
  }).sort((a, b) => a.connected.length - b.connected.length || a.company.name.localeCompare(b.company.name));

  const ask = (c: Company) => dispatch({ type: "request-supplier-connection", request: {
    id: `req-conn-${customerId}-${c.id}-${Date.now()}`, fromCompanyId: customerId, toCompanyId: c.id, items: ["connect-systems"],
    fiscalYear: Number(db.asOf.slice(0, 4)), sentAt: db.asOf, dueDate: addDays(db.asOf, 30), status: "open",
  } });

  const columns: Column<Row>[] = [
    { key: "supplier", label: "Supplier", render: (r) => <>{r.company.name}<span className="ft-meta">{r.company.city}</span></> },
    { key: "connected", label: "Connected systems", render: (r) => (r.connected.length === 0
      ? <span className="int-meta">Files only</span>
      : <ul className="int-chips" aria-label={`Connected: ${r.connected.map((p) => p.name).join(", ")}`}>
          {r.connected.map((p) => <li key={p.id} className="int-chip"><img src={p.logo} alt="" />{p.name}</li>)}
        </ul>) },
    { key: "status", label: "Request", render: (r) => {
      if (r.pending.length > 0 || r.request?.status === "answered") {
        return <StatusPill tone="success">Supplier asked for setup</StatusPill>;
      }
      if (r.request?.status === "open") return <StatusPill tone="fresh">{`Asked ${date(r.request.sentAt)}`}</StatusPill>;
      return <span className="int-meta">—</span>;
    } },
    { key: "act", label: "", render: (r) => {
      if (r.connected.length === SYSTEMS.length) return <span className="int-meta">All connected</span>;
      if (r.request || r.pending.length > 0) return null; // asked already, or the supplier is setting a system up
      return <Button variant="secondary" size="sm" onClick={() => ask(r.company)} aria-label={`Ask ${r.company.name} to connect its systems`}>Ask to connect</Button>;
    } },
  ];

  return (
    <Card title="Your suppliers' systems" className="int-card">
      <p className="int-sub">
        Suppliers with a connected ERP or logistics platform keep their data current without uploads, so their risk lights are measured,
        not estimated. Ask the others to connect: it's free for them, and they see your request on their Data page.
      </p>
      <DataTable caption="Suppliers and their connected systems" columns={columns} rows={rows} />
      {!live && <p className="int-meta">Demo data: requests stay in this browser.</p>}
    </Card>
  );
}
