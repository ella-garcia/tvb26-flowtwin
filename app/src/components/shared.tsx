// Shared FlowTwin components used across modules. Owned by the lead.
import { useState, type ReactNode } from "react";
import { Icon, StatusPill } from "../keystone";
import { useApp } from "../app/AppContext";
import type { OtifGrade } from "../lib/otif";
import { ALL_PROGRAMS, modelLabel } from "../lib/programs";
import type { Provenance } from "../lib/types";

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

/** Empty state: names what will appear and how to get it. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="ft-empty"><h3 className="ft-heading">{title}</h3>{children && <p>{children}</p>}{action}</div>;
}

/** The supplier risk traffic light. Always colour + dot + word. */
export function RiskLight({ level }: { level: "green" | "amber" | "red" }) {
  const word = level === "red" ? "Act now" : level === "amber" ? "Watch" : "OK";
  return <span className={`ft-light ft-light-${level}`}><i aria-hidden="true" />{word}</span>;
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

/** Vehicle model picker for the key customer. Hidden when no programmes are mapped. The choice is shared by every page. */
export function ModelSelect() {
  const { db, programId, setProgramId } = useApp();
  let programs: ReturnType<typeof db.programs> = [];
  try { programs = db.programs(); } catch { programs = []; }
  if (programs.length === 0) return null;
  const value = programs.some((g) => g.id === programId) ? programId : ALL_PROGRAMS;
  return (
    <label className="ft-model">Vehicle model
      <select value={value} onChange={(e) => setProgramId(e.target.value)}>
        <option value={ALL_PROGRAMS}>All models ({programs.length})</option>
        {programs.map((g) => <option key={g.id} value={g.id}>{modelLabel(g)}</option>)}
      </select>
    </label>
  );
}
