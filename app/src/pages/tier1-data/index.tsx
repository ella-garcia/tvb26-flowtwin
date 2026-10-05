// Your data (key customer): upload suppliers, parts, stock, releases and receipts so the risk lights use real inputs.
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useApp } from "../../app/AppContext";
import { Button, DataTable, StatusPill, type Column, type PillTone } from "../../keystone";
import { Card, PageHeader } from "../../components/shared";
import { date, num } from "../../lib/format";
import * as remote from "../../lib/remote";
import type { UploadIssue, UploadRecord } from "../../lib/types";
import "./tier1-data.css";

interface KindDef { id: string; label: string; contains: string }
const KINDS: KindDef[] = [
  { id: "tier1-suppliers", label: "Suppliers", contains: "Who you buy from: name, city, state, contact and typical transit days." },
  { id: "tier1-parts", label: "Parts", contains: "Each part number, its supplier, daily usage and how critical it is to the line." },
  { id: "tier1-stock", label: "Stock on hand", contains: "How many units of each part you hold today. Optional: units in transit and the next delivery date (ETA)." },
  { id: "tier1-releases", label: "Demand releases", contains: "What you plan to pull from each supplier over the coming weeks." },
  { id: "tier1-receipts", label: "Goods receipts", contains: "What actually arrived and when, so we can measure real delivery times." },
];

type Shown = "none" | "processing" | "uploaded" | "needs-input" | "failed";
const PILL: Record<Shown, { label: string; tone: PillTone }> = {
  none: { label: "Waiting for file", tone: "neutral" },
  processing: { label: "Processing", tone: "fresh" },
  uploaded: { label: "Uploaded", tone: "success" },
  "needs-input": { label: "Needs your input", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
};
const SEV: Record<UploadIssue["severity"], { label: string; tone: PillTone }> = {
  error: { label: "Error", tone: "danger" }, warning: { label: "Warning", tone: "warning" }, info: { label: "Note", tone: "neutral" },
};
const POLL_MS = 3000, POLL_MAX_MS = 120000;

const rawStatus = (u?: UploadRecord) => (u?.status as string | undefined) ?? "waiting";
function shownStatus(u: UploadRecord | undefined, busy: boolean): Shown {
  if (busy) return "processing";
  if (!u) return "none";
  const s = rawStatus(u);
  if (s === "uploaded" || s === "needs-input" || s === "failed") return s;
  if (s === "processing") return "processing";
  return u.fileName && u.uploadedAt ? "processing" : "none"; // waiting with a file means the worker has not picked it up yet
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/row-level security|not authorized|permission|unauthori[sz]ed|403/i.test(m)) return "You can only upload files for your own company.";
  if (/payload too large|exceeded the maximum|too large|413/i.test(m)) return "That file is too large. Try a smaller file or split it.";
  if (/fetch|network|failed to load/i.test(m)) return "Could not reach the server. Check your connection and try again.";
  return `Could not upload the file: ${m}`;
}

const issueCols: Column<UploadIssue & { id: number }>[] = [
  { key: "row", label: "Row", numeric: true, align: "right", render: (r) => (r.row != null ? num(r.row) : "—") },
  { key: "column", label: "Column", render: (r) => r.column ?? "—" },
  { key: "message", label: "Message", render: (r) => r.message },
  { key: "severity", label: "Severity", render: (r) => <StatusPill tone={SEV[r.severity]?.tone ?? "neutral"}>{SEV[r.severity]?.label ?? r.severity}</StatusPill> },
];
const mapCols: Column<{ id: string; from: string; to: string }>[] = [
  { key: "from", label: "Your column", render: (r) => r.from },
  { key: "to", label: "Read as", render: (r) => r.to },
];

export default function Tier1DataPage() {
  const { mode, db, toggles } = useApp();
  const live = mode === "live";
  const companyId = toggles.companyId;
  const [uploads, setUploads] = useState<Record<string, UploadRecord>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState("");
  const timers = useRef<Record<string, number>>({});

  const refresh = useCallback(async () => {
    if (!live) return;
    try {
      const rows = await remote.fetchUploads(companyId);
      setUploads(Object.fromEntries(rows.map((u) => [u.kind as string, u])));
    } catch (e) { setErrors((x) => ({ ...x, _page: friendly(e) })); }
  }, [live, companyId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => () => { Object.values(timers.current).forEach(window.clearInterval); }, []);

  const poll = (kind: string) => {
    const started = Date.now();
    window.clearInterval(timers.current[kind]);
    timers.current[kind] = window.setInterval(async () => {
      try {
        const rows = await remote.fetchUploads(companyId);
        const u = rows.find((r) => (r.kind as string) === kind);
        if (u) setUploads((x) => ({ ...x, [kind]: u }));
        const s = rawStatus(u);
        if (u && s !== "waiting" && s !== "processing") {
          window.clearInterval(timers.current[kind]);
          setBusy((b) => ({ ...b, [kind]: false }));
          setAnnounce(`${KINDS.find((k) => k.id === kind)?.label}: ${PILL[shownStatus(u, false)].label}`);
          return;
        }
      } catch { /* keep trying until the time limit */ }
      if (Date.now() - started > POLL_MAX_MS) {
        window.clearInterval(timers.current[kind]);
        setBusy((b) => ({ ...b, [kind]: false })); // stays "Processing" from the stored row; the worker will finish it later
      }
    }, POLL_MS);
  };

  const onFile = async (kind: string, ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    setErrors((x) => ({ ...x, [kind]: "" }));
    if (!/\.(csv|xlsx)$/i.test(file.name)) { setErrors((x) => ({ ...x, [kind]: "Choose a .csv or .xlsx file." })); return; }
    setBusy((b) => ({ ...b, [kind]: true }));
    try {
      const path = await remote.uploadFile(companyId, kind, file);
      const jobId = await remote.queueParseJob(companyId, kind, path, file.name);
      setUploads((x) => ({ ...x, [kind]: { companyId, kind: kind as UploadRecord["kind"], fileName: file.name, rows: 0, source: "Upload",
        status: "waiting", uploadedAt: new Date().toISOString(), jobId } }));
      setAnnounce(`${file.name} uploaded. Processing.`);
      poll(kind);
    } catch (e) {
      setBusy((b) => ({ ...b, [kind]: false }));
      setErrors((x) => ({ ...x, [kind]: friendly(e) }));
    }
  };

  const demo = !live;
  const demoUploads = demo ? Object.fromEntries((() => { try { return db.uploads(companyId); } catch { return []; } })().map((u) => [u.kind as string, u])) : {};
  const current = (k: string) => (demo ? demoUploads[k] : uploads[k]);

  return (
    <>
      <PageHeader title="Your data" caption="Upload what you already have. Each file updates the risk lights within a few minutes." />
      <div className="t1-list">
        {demo && <p className="t1-note" role="note">Uploads need live data. You're viewing demo data.</p>}
        {errors._page && <p className="t1-error" role="alert">{errors._page}</p>}
        <div className="ft-sr-only" role="status" aria-live="polite">{announce}</div>
        {KINDS.map((k) => {
          const u = current(k.id);
          const shown = shownStatus(u, !!busy[k.id]);
          const issues = (u?.issues ?? []).map((x, i) => ({ ...x, id: i }));
          const mapping = Object.entries(u?.mapping ?? {}).map(([from, to]) => ({ id: from, from, to }));
          const inputId = `t1-file-${k.id}`;
          return (
            <Card key={k.id} className="t1-card">
              <div className="t1-top">
                <div>
                  <h2 className="t1-title">{k.label}</h2>
                  <p className="t1-sub">{k.contains}</p>
                </div>
                <StatusPill tone={PILL[shown].tone}>{PILL[shown].label}</StatusPill>
              </div>
              <div className="t1-row">
                <a className="t1-link" href={`/templates/${k.id}.csv`} download>Download template</a>
                <span className="t1-file">
                  <Button variant="secondary" icon="upload" disabled={demo || !!busy[k.id]} onClick={() => document.getElementById(inputId)?.click()}>
                    {busy[k.id] ? "Uploading…" : u?.fileName ? "Replace file" : "Choose file"}
                  </Button>
                  <input id={inputId} type="file" accept=".csv,.xlsx" disabled={demo || !!busy[k.id]} aria-label={`Choose a file for ${k.label}`}
                    style={{ display: "none" }} onChange={(e) => onFile(k.id, e)} />
                </span>
                <span className="t1-meta">
                  {u?.fileName ? `${u.fileName} · ${num(u.rows)} rows${u.uploadedAt ? ` · ${date(u.uploadedAt)}, ${new Date(u.uploadedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}` : "No file yet"}
                </span>
              </div>
              {errors[k.id] && <p className="t1-error" role="alert">{errors[k.id]}</p>}
              {shown === "processing" && (
                <p className="t1-sub">Queued. The worker processes uploads every 2 minutes, so this can take a little while if it isn't running. You can leave this page; the status updates when you come back.</p>
              )}
              {shown === "failed" && <p className="t1-sub">We couldn't read this file. Check it against the template and upload it again.</p>}
              {!demo && (issues.length > 0 || mapping.length > 0) && (
                <div className="t1-detail">
                  {issues.length > 0 && <div><h3>What to check</h3><DataTable columns={issueCols} rows={issues} caption={`Issues found in ${k.label}`} /></div>}
                  {mapping.length > 0 && <div><h3>How we read your columns</h3><DataTable columns={mapCols} rows={mapping} caption={`Column mapping for ${k.label}`} /></div>}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
