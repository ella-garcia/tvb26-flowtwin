// My data: light onboarding for the supplier's operations associate. About 15 minutes.
import { useMemo, useState, type ChangeEvent } from "react";
import { useApp } from "../../app/AppContext";
import { AccessDeniedError } from "../../lib/dataLayer";
import type { Machine, Partner, UploadKind, UploadRecord } from "../../lib/types";
import { Button, DataTable, Icon, StatusPill, type Column } from "../../keystone";
import { Card, Empty, NotShared, PageHeader } from "../../components/shared";
import { date, num } from "../../lib/format";
import "./data.css";

const KIND_LABEL: Record<UploadKind, string> = {
  "sales-orders": "Sales orders", "purchase-orders": "Purchase orders", inventory: "Inventory", "item-master": "Item list",
  quality: "Quality", freight: "Freight", energy: "Energy bills", fuel: "Fuel",
};
const KINDS = Object.keys(KIND_LABEL) as UploadKind[];

function Saved({ show }: { show: boolean }) {
  return <div className="data-saved-slot" aria-live="polite">{show && <span className="data-saved">Saved for this session</span>}</div>;
}

function NumInput({ label, value, onChange, min = 0, max, step = 1 }:
  { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return <input className="data-input" type="number" aria-label={label} value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step}
    onChange={(e) => onChange(Number(e.target.value))} />;
}

function UploadPill({ status }: { status: UploadRecord["status"] }) {
  return status === "uploaded" ? <StatusPill tone="success">Uploaded</StatusPill>
    : status === "needs-input" ? <StatusPill tone="warning">Needs your input</StatusPill>
    : <StatusPill tone="neutral">Waiting for file</StatusPill>;
}

export default function DataPage() {
  const { db, dispatch, pack } = useApp();
  const companyId = db.viewer.companyId;

  const read = useMemo(() => {
    try {
      return {
        machines: db.machines(companyId),
        suppliers: db.partners(companyId).filter((p) => p.role === "supplier"),
        uploads: db.uploads(companyId),
        parts: db.parts().filter((p) => p.supplierId === companyId),
      };
    } catch (e) { if (e instanceof AccessDeniedError) return { error: e.message }; throw e; }
  }, [db, companyId]);

  const [machineEdits, setMachineEdits] = useState<Record<string, Partial<Machine>>>({});
  const [partnerEdits, setPartnerEdits] = useState<Record<string, Partial<Partner>>>({});
  const [stock, setStock] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const mark = (k: string) => setSaved((s) => ({ ...s, [k]: true }));

  if ("error" in read) return <><PageHeader title="Your data" /><NotShared message={read.error ?? ""} /></>;
  const { machines, suppliers, uploads, parts } = read;

  const m = (r: Machine): Machine => ({ ...r, ...machineEdits[r.id] });
  const setM = (id: string, patch: Partial<Machine>) => { setMachineEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } })); mark("machines"); };
  const p = (r: Partner): Partner => ({ ...r, ...partnerEdits[r.id] });
  const setP = (id: string, patch: Partial<Partner>) => { setPartnerEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } })); mark("partners"); };
  const materialLabel = (id?: string) => pack.materials.find((x) => x.id === id)?.label ?? id ?? "Not set";
  const customerName = (id: string) => db.company(id)?.name ?? id;

  const machineCols: Column<Machine>[] = [
    { key: "name", label: "Machine", render: (r) => r.name },
    { key: "capacityTonnes", label: "Tonnage", numeric: true, align: "right", render: (r) =>
      <NumInput label={`Tonnage of ${r.name}`} value={m(r).capacityTonnes} onChange={(v) => setM(r.id, { capacityTonnes: v })} /> },
    { key: "shiftsPerWeek", label: "Shifts per week", numeric: true, align: "right", render: (r) =>
      <NumInput label={`Shifts per week for ${r.name}`} value={m(r).shiftsPerWeek} max={21} onChange={(v) => setM(r.id, { shiftsPerWeek: v })} /> },
    { key: "utilization", label: "Utilization (%)", numeric: true, align: "right", render: (r) =>
      <NumInput label={`Utilization of ${r.name} in percent`} value={Math.round(m(r).utilization * 100)} max={100} onChange={(v) => setM(r.id, { utilization: v / 100 })} /> },
  ];
  const supplierCols: Column<Partner>[] = [
    { key: "name", label: "Your supplier", render: (r) => <>{r.name}<div className="ft-muted" style={{ fontSize: 12 }}>{r.city}</div></> },
    { key: "material", label: "Material", render: (r) => materialLabel(r.material) },
    { key: "leadTimeDays", label: "Lead time (days)", numeric: true, align: "right", render: (r) =>
      <NumInput label={`Lead time in days for ${r.name}`} value={p(r).leadTimeDays ?? 0} onChange={(v) => setP(r.id, { leadTimeDays: v })} /> },
    { key: "leadTimeVariability", label: "Variability (%)", numeric: true, align: "right", render: (r) =>
      <NumInput label={`Lead time variability in percent for ${r.name}`} value={Math.round((p(r).leadTimeVariability ?? 0) * 100)} max={100} onChange={(v) => setP(r.id, { leadTimeVariability: v / 100 })} /> },
  ];

  const record = (kind: UploadKind, fileName: string, rows: number) => dispatch({
    type: "record-upload",
    upload: { companyId, kind, fileName, rows, source: "Excel", status: "uploaded", uploadedAt: db.asOf },
  });
  const onFile = (kind: UploadKind) => (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) record(kind, f.name, 0);
    e.target.value = "";
  };
  const sampleRows: Record<UploadKind, number> = {
    "sales-orders": 1840, "purchase-orders": 960, inventory: 420, "item-master": 138, quality: 310, freight: 540, energy: 12, fuel: 12,
  };
  const uploadRows: UploadRecord[] = KINDS.map((k) => uploads.find((u) => u.kind === k)
    ?? { companyId, kind: k, fileName: "", rows: 0, source: "", status: "waiting" as const });
  const uploadCols: Column<UploadRecord & { id: string }>[] = [
    { key: "kind", label: "File", render: (r) => KIND_LABEL[r.kind] },
    { key: "status", label: "Status", render: (r) => <UploadPill status={r.status} /> },
    { key: "fileName", label: "Latest file", render: (r) => r.fileName
      ? <>{r.fileName}<div className="ft-muted" style={{ fontSize: 12 }}>{r.uploadedAt && date(r.uploadedAt)}{r.rows > 0 && <> · {num(r.rows)} rows</>}</div></>
      : <span className="ft-muted">None yet</span> },
    { key: "act", label: "Add a file", render: (r) => (
      <div className="data-up">
        <label className="data-file ks-btn ks-btn-secondary ks-btn-sm">
          <Icon name="upload" />Choose file
          <input type="file" accept=".csv,.xlsx" aria-label={`Choose a file for ${KIND_LABEL[r.kind]}`} onChange={onFile(r.kind)} />
        </label>
        <Button variant="secondary" size="sm" onClick={() => record(r.kind, `${r.kind}-sample.csv`, sampleRows[r.kind])}>Use sample file</Button>
      </div>) },
  ];

  const done = uploadRows.filter((u) => u.status === "uploaded").length;

  const steps: { title: string; sub: string; body: React.ReactNode; key: string }[] = [
    { key: "machines", title: "Capacity", sub: "Check each machine. This tells us how much extra volume you can take.", body:
      machines.length ? <DataTable columns={machineCols} rows={machines} caption="Machines" />
        : <Empty title="No machines yet">Add your presses by uploading a machine list in step 4.</Empty> },
    { key: "partners", title: "Lead times", sub: "How long your own suppliers take to deliver, and how much that varies.", body:
      suppliers.length ? <DataTable columns={supplierCols} rows={suppliers} caption="Your suppliers" />
        : <Empty title="No suppliers yet">Upload your purchase orders in step 4 and we will list them here.</Empty> },
    { key: "stock", title: "Stock you hold for each customer", sub: "Units of each part you keep ready for your customer.", body:
      parts.length ? <DataTable<typeof parts[number]> rows={parts} caption="Stock you hold" columns={[
        { key: "part", label: "Part", render: (r) => <>{r.name}<div className="ft-muted" style={{ fontSize: 12 }}>{r.number}</div></> },
        { key: "customer", label: "Customer", render: (r) => customerName(r.customerId) },
        { key: "mine", label: "Units you hold", numeric: true, align: "right", render: (r) =>
          <NumInput label={`Units of ${r.name} you hold`} value={stock[r.id] ?? 0} onChange={(v) => { setStock((s) => ({ ...s, [r.id]: v })); mark("stock"); }} /> },
        { key: "cover", label: "Customer cover", numeric: true, align: "right", render: (r) => `${num(r.daysOfCover, 1)} days` },
      ]} /> : <Empty title="No parts listed">When a customer shares its part list with you, it appears here.</Empty> },
    { key: "uploads", title: "Upload files", sub: `CSV or Excel. ${done} of ${KINDS.length} files uploaded. Not sure? Use a sample file to see how it works.`, body:
      <DataTable columns={uploadCols} rows={uploadRows.map((u) => ({ ...u, id: u.kind }))} caption="Files" /> },
  ];

  return (
    <div className="data-stack">
      <PageHeader title="Your data" caption="About 15 minutes. Your customer sponsors your account." />
      <ol className="data-steps">
        {steps.map((s, i) => (
          <li key={s.key} className="data-step">
            <span className="data-step-no" aria-hidden="true">{i + 1}</span>
            <div className="data-step-body">
              <Card title={`Step ${i + 1}: ${s.title}`}>
                <p className="data-step-sub">{s.sub}</p>
                {s.body}
                {s.key !== "uploads" && <Saved show={!!saved[s.key]} />}
              </Card>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
