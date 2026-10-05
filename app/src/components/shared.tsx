// Shared FlowTwin components used across modules. Owned by the lead.
import { useState, type ReactNode } from "react";
import { Icon, StatusPill } from "../keystone";
import { date, pct } from "../lib/format";
import type { Provenance } from "../lib/types";

/** Page header: title (Keystone `title` style) with an optional caption and actions on the right. */
export function PageHeader({ title, caption, actions }: { title: string; caption?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ft-pagehead">
      <div>
        <h1 className="ft-title">{title}</h1>
        {caption && <p className="ft-caption">{caption}</p>}
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

/** "Twin synced with your data up to …" — always visible for supplier roles. */
export function SyncBadge({ syncedThrough, accuracy }: { syncedThrough: string; accuracy?: number }) {
  return (
    <span className="ft-sync" title="The digital twin is rebuilt every time you upload data">
      <Icon name="sync" size={16} />
      Twin synced with your data up to {date(syncedThrough)}
      {accuracy != null && <> · matches reality {pct(accuracy, 0)}</>}
    </span>
  );
}

/** Measured vs estimated marker. Estimated values also get the hatched style via .ft-estimated. */
export function ProvenanceTag({ provenance }: { provenance: Provenance }) {
  return provenance === "measured"
    ? <StatusPill tone="neutral">Measured</StatusPill>
    : <StatusPill tone="warning">Estimated</StatusPill>;
}

/** Expandable "How it is calculated" panel: formula, data used, and provenance. Put on every calculated figure. */
export function FormulaSource({ formula, data, provenance, factor }:
  { formula: string; data: string; provenance?: Provenance; factor?: string }) {
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
          {factor && <><dt>Emission factor</dt><dd>{factor}</dd></>}
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

/** Status words for KPI comparisons. */
export function KpiStatusPill({ status }: { status: "on-track" | "watch" | "below" }) {
  if (status === "on-track") return <StatusPill tone="success">On track</StatusPill>;
  if (status === "watch") return <StatusPill tone="warning">Watch</StatusPill>;
  return <StatusPill tone="danger">Below target</StatusPill>;
}

/** The supplier risk traffic light. Always colour + dot + word. */
export function RiskLight({ level }: { level: "green" | "amber" | "red" }) {
  const word = level === "red" ? "Act now" : level === "amber" ? "Watch" : "OK";
  return <span className={`ft-light ft-light-${level}`}><i aria-hidden="true" />{word}</span>;
}
