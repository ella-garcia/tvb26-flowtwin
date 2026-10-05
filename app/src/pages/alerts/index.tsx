// Tier 1 alerts feed. Reads via useApp().db only; writes via dispatch.
import { useEffect, useState } from "react";
import { useApp } from "../../app/AppContext";
import { AlertStatusPill, Card, CritPill, Empty, PageHeader, RiskLight, ScopedError } from "../../components/shared";
import { Button, FilterChip, StatusPill } from "../../keystone";
import { date, dateTime } from "../../lib/format";
import { ALERT_STATUS } from "../../lib/labels";
import { modelLabel, programsOf } from "../../lib/programs";
import * as remote from "../../lib/remote";
import { useScoped } from "../../lib/useScoped";
import type { Alert, AlertNotification, Part, RiskLevel } from "../../lib/types";
import "./alerts.css";

type Status = Alert["status"];
type Filter = "all" | Status;
const rank = (l: RiskLevel) => (l === "red" ? 0 : l === "amber" ? 1 : 2);

export default function AlertsPage() {
  const { db, dispatch, go, mode } = useApp();
  const [notes, setNotes] = useState<Record<string, AlertNotification[]>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Record<string, string>>({});

  const loaded = useScoped(() => {
    const alerts = [...db.alerts()].sort((a, b) => rank(a.level) - rank(b.level) || b.createdAt.localeCompare(a.createdAt));
    return { alerts, parts: db.parts(), programs: db.programs() };
  }, [db]);

  const alertKey = loaded.ok ? loaded.data.alerts.map((a) => a.id).join(",") : "";
  useEffect(() => {
    if (mode !== "live" || !alertKey) { setNotes({}); return; }
    let cancelled = false;
    remote.fetchNotifications(alertKey.split(",")).then((rows) => {
      if (cancelled) return;
      const by: Record<string, AlertNotification[]> = {};
      for (const r of rows) (by[r.alertId] ??= []).push(r);
      setNotes(by);
    }).catch(() => { if (!cancelled) setNotes({}); }); // the line is optional; the alert still shows without it
    return () => { cancelled = true; };
  }, [mode, alertKey]);

  if (!loaded.ok) return <ScopedError title="Alerts" error={loaded.error} />;
  const { alerts, parts, programs } = loaded.data;
  const shown = alerts.filter((a) => filter === "all" || a.status === filter);
  const n = (s: Status) => alerts.filter((a) => a.status === s).length;
  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: `All (${alerts.length})` },
    ...(Object.keys(ALERT_STATUS) as Status[]).map((s) => ({ id: s as Filter, label: `${ALERT_STATUS[s].label} (${n(s)})` })),
  ];

  return (
    <>
      <PageHeader title="Alerts" caption={`${n("new")} new · ${alerts.length} in total`} />
      <div className="alerts-filters" role="group" aria-label="Filter alerts by status">
        {chips.map((c) => <FilterChip key={c.id} pressed={filter === c.id} onClick={() => setFilter(c.id)}>{c.label}</FilterChip>)}
      </div>

      {shown.length === 0 ? (
        <Empty title={alerts.length === 0 ? "No alerts" : "No alerts with this status"}>
          {alerts.length === 0 ? "When a supplier's risk turns amber or red, the alert appears here with suggested actions." : "Try another status."}
        </Empty>
      ) : (
        <div className="alerts-list">
          {shown.map((a) => {
            const supplier = db.company(a.supplierId);
            const aParts = a.partIds.map((id) => parts.find((p) => p.id === id)).filter((p): p is Part => !!p);
            const chosen = picked[a.id] ?? a.chosenActionId ?? "";
            const closed = a.status === "resolved";
            const changed = chosen !== "" && chosen !== a.chosenActionId;
            return (
              <Card key={a.id} className="alerts-card">
                <div className="alerts-top">
                  <RiskLight level={a.level} />
                  <AlertStatusPill status={a.status} />
                  <span className="alerts-meta">{date(a.createdAt)}</span>
                </div>
                <div>
                  <h2 className="alerts-title">{a.title}</h2>
                  <p className="alerts-meta">{supplier?.name ?? a.supplierId}{supplier ? ` · ${supplier.city}, ${supplier.state}` : ""}</p>
                </div>
                <p className="alerts-msg">{a.message}</p>

                <dl className="alerts-facts">
                  <div><dt>Parts affected</dt><dd>
                    {aParts.length === 0 ? "No parts listed" : (
                      <ul className="alerts-parts">
                        {aParts.map((p) => (
                          <li key={p.id}><span className="ks-num">{p.number}</span> {p.name}
                            <CritPill c={p.criticality} /></li>
                        ))}
                      </ul>
                    )}
                  </dd></div>
                  {programs.length > 0 && <div><dt>Models affected</dt><dd>{programsOf(aParts, programs).map(modelLabel).join(", ") || "Not mapped"}</dd></div>}
                  <div><dt>Expected shortfall</dt><dd>{a.expectedShortfallDate ? date(a.expectedShortfallDate) : "None expected"}</dd></div>
                </dl>

                {a.supplierResponse && (
                  <div className="alerts-response">
                    <header>
                      Supplier response from {a.supplierResponse.by} · {date(a.supplierResponse.at)}
                      <StatusPill tone={a.supplierResponse.confirmedCapacity ? "success" : "danger"}>
                        {a.supplierResponse.confirmedCapacity ? "Capacity confirmed: Yes" : "Capacity confirmed: No"}
                      </StatusPill>
                    </header>
                    <p>{a.supplierResponse.message}</p>
                  </div>
                )}

                {a.actions.length > 0 && (
                  <fieldset className="alerts-actions" disabled={closed}>
                    <legend>Choose an action</legend>
                    {a.actions.map((act) => (
                      <label key={act.id} className="alerts-opt">
                        <input type="radio" name={`action-${a.id}`} value={act.id} checked={chosen === act.id}
                          onChange={() => setPicked((p) => ({ ...p, [a.id]: act.id }))} />
                        <div><b>{act.label}</b><span>{act.description}</span></div>
                      </label>
                    ))}
                  </fieldset>
                )}

                {(notes[a.id]?.length || a.resolvedBy === "engine") ? (
                  <div className="alerts-notes">
                    {[...(notes[a.id] ?? [])].sort((x, y) => (y.sentAt ?? "").localeCompare(x.sentAt ?? "")).map((n, i) => {
                      const word = n.dryRun ? "dry run" : n.status === "failed" ? "failed" : n.status === "skipped" ? "skipped" : "sent";
                      const when = n.sentAt ? dateTime(n.sentAt) : "";
                      return <p key={n.id ?? i} className="alerts-meta">{n.channel === "whatsapp" ? "Messaged" : "Emailed"} to {n.recipient ?? "a recipient"}{when ? ` · ${when}` : ""} ({word})</p>;
                    })}
                    {a.resolvedBy === "engine" && <p className="alerts-meta">Resolved automatically when the risk turned green</p>}
                  </div>
                ) : null}

                <div className="alerts-buttons">
                  {a.status === "new" && (
                    <Button icon="check" onClick={() => dispatch({ type: "acknowledge-alert", id: a.id, actionId: chosen || undefined })}>Acknowledge</Button>
                  )}
                  {a.status !== "new" && !closed && changed && (
                    <Button icon="check" onClick={() => dispatch({ type: "acknowledge-alert", id: a.id, actionId: chosen })}>Save chosen action</Button>
                  )}
                  {!closed && <Button variant="secondary" onClick={() => dispatch({ type: "resolve-alert", id: a.id })}>Mark resolved</Button>}
                  <Button variant="secondary" icon="eye" onClick={() => go("supplier", a.supplierId)}>View supplier</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
