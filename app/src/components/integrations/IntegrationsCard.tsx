// "Connected systems" on the Data pages (key customer and supplier): which ERPs and platforms send this company's data,
// and a way to ask the FlowTwin team for the rest.
import { useEffect, useState } from "react";
import { useApp } from "../../app/AppContext";
import { Button, StatusPill } from "../../keystone";
import { Card } from "../shared";
import { date, dateTime } from "../../lib/format";
import * as remote from "../../lib/remote";
import type { Connection } from "../../lib/types";
import { integrationState, PROVIDERS, type IntegrationState, type ProviderId } from "./providers";
import "./integrations.css";

export function IntegrationsCard({ companyId, intro, onRequested }: {
  companyId: string;
  intro?: string;
  /** Called after a request is saved (or recorded locally in demo mode). */
  onRequested?: (provider: ProviderId) => void;
}) {
  const { mode, db } = useApp();
  const live = mode === "live";
  const company = db.company(companyId);
  const synthetic = company?.synthetic ?? false;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<ProviderId | null>(null);
  const [error, setError] = useState("");
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    remote.fetchConnections(companyId).then(
      (rows) => { if (!cancelled) setConnections(rows); },
      () => { if (!cancelled) setConnections([]); },  // no table yet or not shared: fall back to the default view
    );
    return () => { cancelled = true; };
  }, [live, companyId]);

  const request = async (id: ProviderId, name: string) => {
    setError("");
    if (!live) { // demo data: nothing to send to
      setRequested((s) => new Set(s).add(id));
      setAnnounce(`${name}: requested`);
      onRequested?.(id);
      return;
    }
    setSending(id);
    try {
      const row = await remote.requestConnection(id);
      setConnections((cs) => [...cs.filter((c) => c.id !== row.id), row]);
      setAnnounce(`${name}: request sent`);
      onRequested?.(id);
    } catch (e) {
      setError(`Could not send the request for ${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(null);
    }
  };

  return (
    <Card title="Connected systems" className="int-card">
      <p className="int-sub">{intro ?? "Connected systems send your data automatically. Everything else works with the file uploads below."}</p>
      <div className="ft-sr-only" role="status" aria-live="polite">{announce}</div>
      {error && <p className="int-error" role="alert">{error}</p>}
      <ul className="int-grid">
        {PROVIDERS.map((p) => {
          const st = integrationState(p.id, { companyId, synthetic, connections, requested, kind: company?.kind });
          return (
            <li key={p.id} className="int">
              <div className="int-logo"><img src={p.logo} alt={`${p.name} logo`} loading="lazy" /></div>
              <div className="int-body">
                <h3 className="int-name">{p.name}<span className="int-kind">{p.kind}</span></h3>
                <p className="int-sends">{p.sends}</p>
              </div>
              <div className="int-foot">
                {st.status === "available"
                  ? <Button variant="secondary" size="sm" disabled={sending === p.id} onClick={() => request(p.id, p.name)}
                      aria-label={`Request to connect ${p.name}`}>{sending === p.id ? "Sending…" : "Request to connect"}</Button>
                  : <><StatusPill tone={st.status === "connected" ? "success" : "fresh"}>{st.status === "connected" ? "Connected" : "Requested"}</StatusPill>
                      <span className="int-meta">{detail(p.id, st, live)}</span></>}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function detail(p: ProviderId, st: IntegrationState, live: boolean): string {
  if (st.status === "connected") {
    if (p === "file-drop") return "Always available";
    if (st.lastRunAt) return `Last sync ${dateTime(st.lastRunAt)}`;
    return st.syncedHoursAgo != null ? `Last sync ${st.syncedHoursAgo} ${st.syncedHoursAgo === 1 ? "hour" : "hours"} ago` : "";
  }
  if (st.status === "requested") {
    if (!live) return "Demo data: not sent";
    return st.requestedAt ? `Sent ${date(st.requestedAt.slice(0, 10))}. We'll set it up with you.` : "Sent. We'll set it up with you.";
  }
  return "";
}
