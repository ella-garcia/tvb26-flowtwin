// Step "Circularity": the supplier's own circular practices. Private until the owner shares a summary.
import { useState } from "react";
import { useApp } from "../../app/AppContext";
import type { CircularProfile, ScrapRoute } from "../../lib/types";
import { Button } from "../../keystone";

const ROUTES: { id: ScrapRoute; label: string }[] = [
  { id: "recycler", label: "Sold to a recycler" }, { id: "mill-return", label: "Returned to the steel mill" },
  { id: "internal-remelt", label: "Remelted in-house" }, { id: "landfill", label: "Landfill" }, { id: "unknown", label: "Don't know" },
];
const toStr = (v?: number, scale = 1) => (v === undefined ? "" : String(Math.round(v * scale * 1000) / 1000));

export function CircularityForm({ companyId, year, existing }: { companyId: string; year: number; existing?: CircularProfile }) {
  const { dispatch } = useApp();
  const [scrapRate, setScrapRate] = useState(toStr(existing?.scrapRate, 100));
  const [scrapTonnes, setScrapTonnes] = useState(toStr(existing?.scrapTonnes));
  const [route, setRoute] = useState<ScrapRoute>(existing?.scrapRoute ?? "unknown");
  const [recycled, setRecycled] = useState(toStr(existing?.recycledContentPct, 100));
  const [returnable, setReturnable] = useState(toStr(existing?.returnablePackagingPct, 100));
  const [renewable, setRenewable] = useState(toStr(existing?.renewableElectricityPct, 100));
  const [iso, setIso] = useState(existing?.iso14001 ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const parse = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));
  const pctOk = (s: string) => { const v = parse(s); return v === undefined || (Number.isFinite(v) && v >= 0 && v <= 100); };

  const save = () => {
    const e: Record<string, string> = {};
    if (!pctOk(scrapRate)) e.scrapRate = "Enter a number from 0 to 100.";
    if (!pctOk(recycled)) e.recycled = "Enter a number from 0 to 100.";
    if (!pctOk(returnable)) e.returnable = "Enter a number from 0 to 100.";
    if (!pctOk(renewable)) e.renewable = "Enter a number from 0 to 100.";
    const t = parse(scrapTonnes);
    if (t !== undefined && (!Number.isFinite(t) || t < 0)) e.scrapTonnes = "Enter tonnes of 0 or more.";
    setErrors(e); setSaved(false);
    if (Object.keys(e).length) return;
    const frac = (s: string) => { const v = parse(s); return v === undefined ? undefined : v / 100; };
    dispatch({ type: "save-circular-profile", profile: {
      companyId, year, scrapRate: frac(scrapRate), scrapTonnes: t, scrapRoute: route,
      recycledContentPct: frac(recycled), returnablePackagingPct: frac(returnable), renewableElectricityPct: frac(renewable),
      iso14001: iso, notes: notes.trim() || undefined, provenance: "estimated",
    } });
    setSaved(true);
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, unit: string, hint?: string) => (
    <div className="data-field">
      <label htmlFor={`circ-${id}`}>{label}</label>
      <div className="data-field-row">
        <input id={`circ-${id}`} className="ft-control data-input" type="number" inputMode="decimal" min={0} value={value}
          aria-invalid={!!errors[id]} aria-describedby={errors[id] ? `circ-${id}-err` : undefined}
          onChange={(e) => { set(e.target.value); setSaved(false); }} />
        <span className="ft-meta">{unit}</span>
      </div>
      {hint && <span className="ft-meta">{hint}</span>}
      {errors[id] && <span id={`circ-${id}-err`} className="data-error" role="alert">Problem: {errors[id]}</span>}
    </div>
  );

  return (
    <div className="data-circ">
      <p className="data-circ-private">
        This stays private. Only your owner can share a summary with a customer, and costs, prices and margins are never shared.
      </p>
      <div className="data-circ-grid">
        {field("scrapRate", `Scrap rate for ${year}`, scrapRate, setScrapRate, "%", "Scrap as a share of the material you use.")}
        {field("scrapTonnes", "Scrap tonnes", scrapTonnes, setScrapTonnes, "tonnes")}
        <div className="data-field">
          <label htmlFor="circ-route">Where your scrap goes</label>
          <select id="circ-route" className="ft-control" value={route} onChange={(e) => { setRoute(e.target.value as ScrapRoute); setSaved(false); }}>
            {ROUTES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        {field("recycled", "Recycled content", recycled, setRecycled, "%")}
        {field("returnable", "Returnable packaging", returnable, setReturnable, "%", "Share of shipments in returnable containers.")}
        {field("renewable", "Renewable electricity", renewable, setRenewable, "%")}
      </div>
      <label className="data-check">
        <input type="checkbox" checked={iso} onChange={(e) => { setIso(e.target.checked); setSaved(false); }} />
        We hold an ISO 14001 environmental certificate
      </label>
      <div className="data-field">
        <label htmlFor="circ-notes">Notes (private, never shared)</label>
        <textarea id="circ-notes" className="ft-control data-notes" value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} />
      </div>
      <div className="data-circ-actions">
        <Button icon="check" onClick={save}>Save circularity</Button>
        <div className="data-saved-slot" aria-live="polite">
          {saved && <span className="data-saved">Saved. Private to your company until you share it.</span>}
        </div>
      </div>
    </div>
  );
}
