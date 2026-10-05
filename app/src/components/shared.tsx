// Shared FlowTwin components used across modules. Owned by the lead.
import { useState, type ReactNode } from "react";
import { Icon, StatusPill } from "../keystone";
import { useApp } from "../app/AppContext";
import { num, riskWord } from "../lib/format";
import { ALERT_STATUS, ALERT_STATUS_FOR_SUPPLIER, CRIT_LABEL, CRIT_TONE, DATA_STATUS } from "../lib/labels";
import type { OtifGrade } from "../lib/otif";
import { ALL_PROGRAMS, modelLabel } from "../lib/programs";
import { scoped } from "../lib/useScoped";
import type { Alert, FlexResult, Part, Provenance, RiskAssessment } from "../lib/types";

/** Page header: title (Keystone `title` style) with an optional company mark, caption and actions on the right. */
export function PageHeader({ title, caption, actions, logo }: { title: string; caption?: ReactNode; actions?: ReactNode; logo?: ReactNode }) {
  return (
    <div className="ft-pagehead">
      <div className="ft-pagehead-main">
        {logo}
        <div>
          <h1 className="ft-title">{title}</h1>
          {caption && <p className="ft-caption">{caption}</p>}
        </div>
      </div>
      {actions && <div className="ft-actions">{actions}</div>}
    </div>
  );
}

/** A bordered card section with a `heading`. */
export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ft-card ${className ?? ""}`}>
      {(title || actions) && <div className="ft-card-head">{title && <h2 className="ft-heading">{title}</h2>}{actions}</div>}
      {children}
    </section>
  );
}

/** Measured vs estimated marker. Estimated values also get the hatched style via .ft-estimated. */
export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return provenance === "measured"
    ? <StatusPill tone="neutral">Measured</StatusPill>
    : <StatusPill tone="warning">Estimated</StatusPill>;
}

/** Expandable "How it is calculated" panel: formula, data used, and provenance. Put on every calculated figure. */
export function FormulaSource({ formula, data, provenance }: { formula: string; data: string; provenance?: Provenance }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ft-formula">
      <button type="button" className="ft-linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="info" size={16} />{open ? "Hide calculation" : "How it is calculated"}
      </button>
      {open && (
        <dl>
          <dt>Formula</dt><dd>{formula}</dd>
          <dt>Data</dt><dd>{data}</dd>
          {provenance && <><dt>Source</dt><dd><ProvenanceTag provenance={provenance} /></dd></>}
        </dl>
      )}
    </div>
  );
}

/** Shown when the data layer refuses a read (AccessDeniedError). */
export function NotShared({ message }: { message: string }) {
  return (
    <div className="ft-notshared" role="alert">
      <Icon name="lock" />
      <div><strong>Not shared with you</strong><p>{message}</p></div>
    </div>
  );
}

/** A refused read (useScoped's error): the page title, when given, above <NotShared>. */
export function ScopedError({ title, error }: { title?: string; error: string }) {
  return <>{title && <PageHeader title={title} />}<NotShared message={error} /></>;
}

/** Empty state: names what will appear and how to get it. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="ft-empty"><h3 className="ft-heading">{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

/** The supplier risk traffic light. Always colour + dot + word. */
export function RiskLight({ level }: { level: "green" | "amber" | "red" }) {
  return <span className={`ft-light ft-light-${level}`}><i aria-hidden="true" />{riskWord(level)}</span>;
}

/** Placeholder company logo: initials in a tile. Swap for the customer's real logo when they provide one. */
export function CompanyMark({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter((w) => /^[A-ZÁÉÍÓÚÑ]/.test(w)).slice(0, 3).map((w) => w[0]).join("") || name.slice(0, 2).toUpperCase();
  return <span className="ft-mark" role="img" aria-label={`${name} logo`}>{initials}</span>;
}

/** Delivery performance grade (from OTIF history). Always letter + word. */
export function GradePill({ grade }: { grade: OtifGrade }) {
  if (grade === "A") return <StatusPill tone="success">A · On target</StatusPill>;
  if (grade === "B") return <StatusPill tone="warning">B · Slightly below</StatusPill>;
  return <StatusPill tone="danger">C · Below target</StatusPill>;
}

/** Part criticality: Line stopper / High / Normal. */
export function CritPill({ c }: { c: Part["criticality"] }) {
  return <StatusPill tone={CRIT_TONE[c]}>{CRIT_LABEL[c]}</StatusPill>;
}

/** How much of the supplier's own data feeds the score: Connected / Invited / Public data only. */
export function DataStatusPill({ status }: { status: RiskAssessment["dataStatus"] }) {
  const s = DATA_STATUS[status] ?? DATA_STATUS["public-only"];
  return <StatusPill tone={s.tone}>{s.label}</StatusPill>;
}

/** Alert status. Same tone for every audience; the supplier gets words written for it. */
export function AlertStatusPill({ status, audience = "customer" }: { status: Alert["status"]; audience?: "customer" | "supplier" }) {
  const s = ALERT_STATUS[status];
  return <StatusPill tone={s.tone}>{audience === "supplier" ? ALERT_STATUS_FOR_SUPPLIER[status] : s.label}</StatusPill>;
}

/** Result of the contract demand-swing test. `compact` says Yes / No for table cells. */
export function FlexPill({ flex, compact }: { flex: FlexResult; compact?: boolean }) {
  const word = compact ? (flex.canAbsorb ? "Yes" : "No") : flex.canAbsorb ? "Can absorb" : "Cannot absorb";
  return <StatusPill tone={flex.canAbsorb ? "success" : "danger"}>{word}</StatusPill>;
}

/** OTIF change in fraction points (last 4 weeks vs first 4): ▲ / ▼ with the size, or "No change". */
export function OtifDelta({ change, long }: { change: number; long?: boolean }) {
  const tail = long ? ", last 4 weeks vs first 4" : "";
  if (Math.abs(change) < 0.0005) return <span className="ft-delta ft-delta-flat">No change{tail}</span>;
  return (
    <span className={`ft-delta ${change > 0 ? "ft-delta-up" : "ft-delta-down"}`}>
      {change > 0 ? "▲" : "▼"} {num(Math.abs(change) * 100, 1)} {long ? "points" : "pts"}{tail}
    </span>
  );
}

/** Vehicle model picker for the key customer. Hidden when no programmes are mapped. The choice is shared by every page. */
export function ModelSelect() {
  const { db, programId, setProgramId } = useApp();
  const read = scoped(() => db.programs());
  const programs = read.ok ? read.data : [];
  if (programs.length === 0) return null;
  const value = programs.some((g) => g.id === programId) ? programId : ALL_PROGRAMS;
  return (
    <label className="ft-model">Vehicle model
      <select className="ft-control" value={value} onChange={(e) => setProgramId(e.target.value)}>
        <option value={ALL_PROGRAMS}>All models ({programs.length})</option>
        {programs.map((g) => <option key={g.id} value={g.id}>{modelLabel(g)}</option>)}
      </select>
    </label>
  );
}
