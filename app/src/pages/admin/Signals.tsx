// Admin: external signals that feed the risk lights.
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { useScoped } from "../../lib/useScoped";
import type { Signal, SignalKind } from "../../lib/types";
import { Button, DataTable, FilterChip, StatusPill, type Column } from "../../keystone";
import { Card, PageHeader, ProvenanceTag, ScopedError } from "../../components/shared";
import { date } from "../../lib/format";
import { setSignalActive, upsertAnnouncedSignal, type AnnouncedSignal } from "../../lib/adminSignals";
import { AddSignalForm } from "./AddSignalForm";
import "./admin.css";

const KIND_LABEL: Record<SignalKind, string> = { weather: "Weather", road: "Road", theft: "Theft", port: "Port", customs: "Customs", blockade: "Blockade", supplier: "Supplier",
  policy: "Trade policy", "supplier-input": "Input shortage" };

export default function SignalsPage() {
  const { db, mode, retry } = useApp();
  const live = mode === "live";
  const [kind, setKind] = useState<SignalKind | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const read = useScoped(() => db.signals(), [db]);
  const head = <PageHeader title="Signals" actions={!adding && <Button icon="plus" onClick={() => setAdding(true)}>Add signal</Button>}
    caption="External events that feed the risk lights: weather forecasts, road closures and blockades, US border waits and theft priors, refreshed every hour, plus events an admin announces here." />;
  if (!read.ok) return <>{head}<ScopedError error={read.error} /></>;
  const signals = read.data;

  const kinds = Array.from(new Set(signals.map((s) => s.kind)));
  const inactiveCount = signals.filter((s) => s.active === false).length;
  const rows = signals.filter((s) => (kind === "all" || s.kind === kind) && (showInactive || s.active !== false));
  const save = async (sig: AnnouncedSignal) => { await upsertAnnouncedSignal(sig); setAdding(false); retry(); };
  const toggle = async (s: Signal) => {
    setBusy(s.id); setProblem(null);
    try { await setSignalActive(s.id, s.active === false); retry(); }
    catch (e) { setProblem(`Could not ${s.active === false ? "enable" : "disable"} "${s.title}": ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };
  const sev = (s: Signal["severity"]) => <StatusPill tone={s === "high" ? "danger" : s === "medium" ? "warning" : "neutral"}>{s === "high" ? "High" : s === "medium" ? "Medium" : "Low"}</StatusPill>;
  const cols: Column<Signal>[] = [
    { key: "kind", label: "Kind", render: (r) => <StatusPill tone="neutral">{KIND_LABEL[r.kind]}</StatusPill> },
    { key: "title", label: "Title", render: (r) => <>{r.title}{r.active === false && <> <StatusPill tone="neutral">Inactive</StatusPill></>}<span className="ft-meta">{r.description}</span></> },
    { key: "state", label: "State" },
    { key: "highways", label: "Highways", render: (r) => r.highways.join(", ") || "None" },
    { key: "dates", label: "Active", render: (r) => `${date(r.startsAt)} to ${date(r.endsAt)}` },
    { key: "severity", label: "Severity", render: (r) => sev(r.severity) },
    { key: "transitMultiplier", label: "Transit effect", numeric: true, render: (r) => `× ${r.transitMultiplier}` },
    { key: "source", label: "Source", render: (r) => <>{r.shortLabel ?? r.source}{r.shortLabel && r.shortLabel !== r.source && <span className="ft-meta">{r.source}</span>}</> },
    { key: "provenance", label: "Provenance", render: (r) => <ProvenanceTag provenance={r.provenance} /> },
    { key: "active", label: "Action", render: (r) => (
      <Button size="sm" variant="secondary" disabled={!live || busy === r.id} onClick={() => void toggle(r)}
        title={live ? undefined : "Needs the live database"} aria-label={`${r.active === false ? "Enable" : "Disable"} ${r.title}`}>
        {r.active === false ? "Enable" : "Disable"}
      </Button>) },
  ];
  return (
    <>
      {head}
      {adding && <Card title="Add signal" className="admin-card"><AddSignalForm live={live} onSave={save} onCancel={() => setAdding(false)} /></Card>}
      {problem && <p className="admin-error" role="alert">Problem: {problem}</p>}
      <p className="ft-meta">{live ? "A feed turns its own signals back on at its next hourly run while it still reports them."
        : "Disable and Enable need the live database; the demo data is read-only."}</p>
      <div className="ft-toolbar" role="group" aria-label="Filter by kind">
        <FilterChip pressed={kind === "all"} onClick={() => setKind("all")}>All kinds</FilterChip>
        {kinds.map((k) => <FilterChip key={k} pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</FilterChip>)}
        {inactiveCount > 0 && <FilterChip pressed={showInactive} onClick={() => setShowInactive((v) => !v)}>{`Show inactive (${inactiveCount})`}</FilterChip>}
      </div>
      <DataTable columns={cols} rows={rows} caption="Signals" />
    </>
  );
}
