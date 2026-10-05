// Admin: external signals that feed the risk lights.
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { useScoped } from "../../lib/useScoped";
import type { Signal, SignalKind } from "../../lib/types";
import { DataTable, FilterChip, StatusPill, type Column } from "../../keystone";
import { PageHeader, ProvenanceTag, ScopedError } from "../../components/shared";
import { date } from "../../lib/format";

const KIND_LABEL: Record<SignalKind, string> = { weather: "Weather", road: "Road", theft: "Theft", port: "Port", blockade: "Blockade", supplier: "Supplier" };

export default function SignalsPage() {
  const { db } = useApp();
  const [kind, setKind] = useState<SignalKind | "all">("all");
  const [showInactive, setShowInactive] = useState(false);
  const read = useScoped(() => db.signals(), [db]);
  const head = <PageHeader title="Signals" caption="External events that feed the risk lights. Seeded for the demo; live feeds come later." />;
  if (!read.ok) return <>{head}<ScopedError error={read.error} /></>;
  const signals = read.data;

  const kinds = Array.from(new Set(signals.map((s) => s.kind)));
  const inactiveCount = signals.filter((s) => s.active === false).length;
  const rows = signals.filter((s) => (kind === "all" || s.kind === kind) && (showInactive || s.active !== false));
  const sev = (s: Signal["severity"]) => <StatusPill tone={s === "high" ? "danger" : s === "medium" ? "warning" : "neutral"}>{s === "high" ? "High" : s === "medium" ? "Medium" : "Low"}</StatusPill>;
  const cols: Column<Signal>[] = [
    { key: "kind", label: "Kind", render: (r) => <StatusPill tone="neutral">{KIND_LABEL[r.kind]}</StatusPill> },
    { key: "title", label: "Title", render: (r) => <>{r.title}{r.active === false && <> <StatusPill tone="neutral">Inactive</StatusPill></>}<div className="ft-muted" style={{ fontSize: 12 }}>{r.description}</div></> },
    { key: "state", label: "State" },
    { key: "highways", label: "Highways", render: (r) => r.highways.join(", ") || "None" },
    { key: "dates", label: "Active", render: (r) => `${date(r.startsAt)} to ${date(r.endsAt)}` },
    { key: "severity", label: "Severity", render: (r) => sev(r.severity) },
    { key: "transitMultiplier", label: "Transit effect", numeric: true, render: (r) => `× ${r.transitMultiplier}` },
    { key: "source", label: "Source", render: (r) => <>{r.shortLabel ?? r.source}{r.shortLabel && r.shortLabel !== r.source && <div className="ft-muted" style={{ fontSize: 12 }}>{r.source}</div>}</> },
    { key: "provenance", label: "Provenance", render: (r) => <ProvenanceTag provenance={r.provenance} /> },
  ];
  return (
    <>
      {head}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }} role="group" aria-label="Filter by kind">
        <FilterChip pressed={kind === "all"} onClick={() => setKind("all")}>All kinds</FilterChip>
        {kinds.map((k) => <FilterChip key={k} pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</FilterChip>)}
        {inactiveCount > 0 && <FilterChip pressed={showInactive} onClick={() => setShowInactive((v) => !v)}>{`Show inactive (${inactiveCount})`}</FilterChip>}
      </div>
      <DataTable columns={cols} rows={rows} caption="Signals" />
    </>
  );
}
