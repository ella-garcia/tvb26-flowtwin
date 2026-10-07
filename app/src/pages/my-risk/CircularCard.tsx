// Circular summary: requests from customers, owner-only sharing with a preview and confirm step, and revoke.
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import { useScoped } from "../../lib/useScoped";
import type { CircularProfile, CircularSummary, ScrapRoute } from "../../lib/types";
import { Button, StatusPill } from "../../keystone";
import { Card, ProvenanceTag, ScopedError } from "../../components/shared";
import { date, pct, num } from "../../lib/format";

const ROUTE_LABEL: Record<ScrapRoute, string> = {
  recycler: "Sold to a recycler", "mill-return": "Returned to the steel mill", "internal-remelt": "Remelted in-house",
  landfill: "Landfill", unknown: "Don't know",
};
const STATUS_WORD = { open: "Open", "in-review": "In review", answered: "Answered" } as const;

export function summaryOf(p: CircularProfile): CircularSummary {
  const s: CircularSummary = { year: p.year, scrapRoute: p.scrapRoute, iso14001: p.iso14001, provenance: p.provenance };
  if (p.scrapRate !== undefined) s.scrapRate = p.scrapRate;
  if (p.scrapTonnes !== undefined) s.scrapTonnes = p.scrapTonnes;
  if (p.recycledContentPct !== undefined) s.recycledContentPct = p.recycledContentPct;
  if (p.returnablePackagingPct !== undefined) s.returnablePackagingPct = p.returnablePackagingPct;
  if (p.renewableElectricityPct !== undefined) s.renewableElectricityPct = p.renewableElectricityPct;
  return s;
}

function Preview({ summary }: { summary: CircularSummary }) {
  const rows: [string, string][] = [
    ["Year", String(summary.year)],
    ["Scrap rate", summary.scrapRate !== undefined ? pct(summary.scrapRate) : "Not given"],
    ["Scrap tonnes", summary.scrapTonnes !== undefined ? `${num(summary.scrapTonnes, 1)} t` : "Not given"],
    ["Scrap route", ROUTE_LABEL[summary.scrapRoute]],
    ["Recycled content", summary.recycledContentPct !== undefined ? pct(summary.recycledContentPct) : "Not given"],
    ["Returnable packaging", summary.returnablePackagingPct !== undefined ? pct(summary.returnablePackagingPct) : "Not given"],
    ["Renewable electricity", summary.renewableElectricityPct !== undefined ? pct(summary.renewableElectricityPct) : "Not given"],
    ["ISO 14001", summary.iso14001 ? "Yes" : "No"],
  ];
  return (
    <dl className="my-risk-preview">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      <div><dt>Source</dt><dd><ProvenanceTag provenance={summary.provenance} /> Reported by you</dd></div>
    </dl>
  );
}

export function CircularCard() {
  const { db, dispatch, go } = useApp();
  const supplierId = db.viewer.companyId;
  const isOwner = db.viewer.role === "owner";
  const [pending, setPending] = useState<{ customerId: string; requestId?: string } | null>(null);

  const read = useScoped(() => ({
    profiles: db.circularProfiles(supplierId),
    requests: db.requests().filter((r) => r.items.includes("circular")),
    shares: db.shares().filter((s) => s.items.includes("circular")),
    customers: db.customersOf(supplierId).filter((c) => !!db.company(c.customerId)),
  }), [db, supplierId]);

  if (!read.ok) return <ScopedError title="Circular summary" error={read.error} />;
  const { profiles, requests, shares, customers } = read.data;
  const latest = [...profiles].sort((a, b) => b.year - a.year)[0];
  const nameOf = (id: string) => db.company(id)?.name ?? id;
  const approvedBy = db.company(supplierId)?.contact?.name ?? "Owner";

  const confirm = () => {
    if (!pending || !latest) return;
    dispatch({ type: "share-circular", supplierId, customerId: pending.customerId, summary: summaryOf(latest),
      approvedBy, approvedAt: db.asOf, requestId: pending.requestId });
    setPending(null);
  };

  const shareButton = (customerId: string, requestId?: string) => !isOwner ? null : !latest
    ? <Button variant="secondary" size="sm" onClick={() => go("data")}>Fill in Circularity in My data first</Button>
    : <Button variant="secondary" size="sm" icon="check" onClick={() => setPending({ customerId, requestId })}>
        Share circular summary with {nameOf(customerId)}
      </Button>;

  return (
    <>
      <Card title="Requests from your customers">
        {requests.length === 0
          ? <p className="my-risk-note">No customer has asked for your circular summary.</p>
          : <ul className="my-risk-reqs">
              {requests.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{nameOf(r.fromCompanyId)}</strong>
                    <span className="my-risk-from">Sent {date(r.sentAt)} · Due {date(r.dueDate)}</span>
                  </div>
                  <StatusPill tone={r.status === "answered" ? "success" : r.status === "open" ? "warning" : "neutral"}>
                    {STATUS_WORD[r.status]}
                  </StatusPill>
                  {r.status !== "answered" && shareButton(r.fromCompanyId, r.id)}
                </li>
              ))}
            </ul>}
        {!isOwner && <p className="my-risk-note">Only your owner can share or revoke.</p>}
      </Card>

      <Card title="Share your circular summary">
        <p className="my-risk-note">
          You choose who sees it. Costs, prices and margins are never shared. Notes stay private.
        </p>
        {!latest && <p className="my-risk-note">
          You have not filled in Circularity yet. {isOwner || db.viewer.role === "ops"
            ? <Button variant="secondary" size="sm" onClick={() => go("data")}>Fill in Circularity in My data first</Button> : null}
        </p>}
        {customers.length > 0 && (
          <ul className="my-risk-reqs">
            {customers.map((c) => {
              const active = shares.filter((s) => s.customerId === c.customerId);
              return (
                <li key={c.customerId}>
                  <div>
                    <strong>{nameOf(c.customerId)}</strong>
                    {active.length === 0
                      ? <span className="my-risk-from">Not shared</span>
                      : active.map((s) => (
                          <span key={s.id} className="my-risk-from">Shared on {date(s.approvedAt)} · version {s.version}</span>))}
                  </div>
                  {active.length > 0
                    ? <StatusPill tone="success">Shared</StatusPill>
                    : <StatusPill tone="neutral">Not shared</StatusPill>}
                  {isOwner && active.map((s) => (
                    <Button key={s.id} variant="secondary" size="sm" onClick={() => dispatch({ type: "revoke-share", id: s.id })}>
                      Revoke
                    </Button>))}
                  {shareButton(c.customerId, requests.find((r) => r.fromCompanyId === c.customerId && r.status !== "answered")?.id)}
                </li>
              );
            })}
          </ul>
        )}
        {!isOwner && <p className="my-risk-note">Only your owner can share or revoke.</p>}
        {pending && latest && isOwner && (
          <div className="my-risk-confirm" role="group" aria-label={`Check before sharing with ${nameOf(pending.customerId)}`}>
            <h3>This is exactly what {nameOf(pending.customerId)} will see</h3>
            <Preview summary={summaryOf(latest)} />
            <p className="my-risk-note">Later changes to your profile are not shared until you share again. You can revoke at any time.</p>
            <div className="my-risk-confirm-actions">
              <Button size="sm" icon="check" onClick={confirm}>Confirm and share</Button>
              <Button variant="secondary" size="sm" onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        )}
        <p className="my-risk-note">Costs, prices and margins are never shared.</p>
      </Card>
    </>
  );
}
