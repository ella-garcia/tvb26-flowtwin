// Admin: enter an announced event (pre-announced blockade or trade-policy event). Live mode only; the server re-checks.
import { useState } from "react";
import { Button } from "../../keystone";
import type { AnnouncedSignal } from "../../lib/adminSignals";

const list = (s: string) => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function AddSignalForm({ live, onSave, onCancel }:
  { live: boolean; onSave: (sig: AnnouncedSignal) => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<AnnouncedSignal["kind"]>("blockade");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [severity, setSeverity] = useState<AnnouncedSignal["severity"]>("high");
  const [state, setState] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [radius, setRadius] = useState("20");
  const [highways, setHighways] = useState("");
  const [mult, setMult] = useState("2");
  const [countries, setCountries] = useState("");
  const [hs, setHs] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Enter a title.";
    if (!startsAt || !endsAt) e.dates = "Enter a start and an end date.";
    else if (endsAt < startsAt) e.dates = "The end date is before the start date.";
    let sig: AnnouncedSignal = { kind, title: title.trim(), description: description.trim(), startsAt, endsAt, severity, state: state.trim() || undefined };
    if (kind === "blockade") {
      const la = num(lat), lo = num(lon), r = num(radius), m = num(mult);
      if (!(la >= 14 && la <= 33) || !(lo >= -118 && lo <= -86)) e.place = "Enter a latitude and longitude in Mexico or at the border.";
      if (!(r > 0 && r <= 200)) e.radius = "Enter a radius from 1 to 200 km.";
      if (!(m >= 1 && m <= 5)) e.mult = "Enter a transit effect from 1 to 5.";
      sig = { ...sig, lat: la, lon: lo, radiusKm: r, transitMultiplier: m, highways: list(highways).map((h) => h.toUpperCase()) };
    } else {
      const c = list(countries).map((x) => x.toUpperCase()), p = list(hs).map((x) => x.replace(/\./g, ""));
      if (!c.length && !p.length) e.affects = "Enter origin countries, HS code prefixes or both.";
      else if (c.some((x) => !/^[A-Z]{2}$/.test(x))) e.affects = "Origin countries are two-letter codes, e.g. CN.";
      else if (p.some((x) => !/^\d{2,10}$/.test(x))) e.affects = "HS code prefixes are 2 to 10 digits, e.g. 8708.";
      sig = { ...sig, affects: { originCountries: c.length ? c : undefined, hsPrefixes: p.length ? p : undefined } };
    }
    setErrors(e); setServerError(null);
    if (Object.keys(e).length) return;
    setSaving(true);
    try { await onSave(sig); } catch (err) { setServerError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); }
  };

  const err = (id: string) => errors[id] && <span id={`sig-${id}-err`} className="admin-error" role="alert">Problem: {errors[id]}</span>;
  const text = (id: string, label: string, value: string, set: (v: string) => void, opts: { type?: string; hint?: string; errKey?: string } = {}) => (
    <div className="admin-field">
      <label htmlFor={`sig-${id}`}>{label}</label>
      <input id={`sig-${id}`} className="ft-control admin-input" type={opts.type ?? "text"} value={value}
        inputMode={opts.type === "number" ? "decimal" : undefined}
        aria-invalid={!!errors[opts.errKey ?? id]} aria-describedby={errors[opts.errKey ?? id] ? `sig-${opts.errKey ?? id}-err` : undefined}
        onChange={(e) => set(e.target.value)} />
      {opts.hint && <span className="ft-meta">{opts.hint}</span>}
    </div>
  );

  return (
    <form className="admin-form" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Add signal">
      {!live && <p id="sig-seed-note" className="admin-note">Adding and disabling signals needs the live database. The demo data on this device is read-only.</p>}
      <fieldset className="admin-fieldset" disabled={!live || saving} aria-describedby={live ? undefined : "sig-seed-note"}>
        <div className="admin-grid">
          <div className="admin-field">
            <label htmlFor="sig-kind">Kind</label>
            <select id="sig-kind" className="ft-control admin-input" value={kind} onChange={(e) => setKind(e.target.value as AnnouncedSignal["kind"])}>
              <option value="blockade">Blockade (announced)</option>
              <option value="policy">Trade policy (tariff, USMCA)</option>
            </select>
          </div>
          {text("title", "Title", title, setTitle)}
          {text("start", "Starts on", startsAt, setStartsAt, { type: "date", errKey: "dates" })}
          {text("end", "Ends on", endsAt, setEndsAt, { type: "date", errKey: "dates" })}
          <div className="admin-field">
            <label htmlFor="sig-severity">Severity</label>
            <select id="sig-severity" className="ft-control admin-input" value={severity} onChange={(e) => setSeverity(e.target.value as AnnouncedSignal["severity"])}>
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </div>
          {text("state", "State", state, setState, { hint: kind === "policy" ? "Leave empty for all of Mexico." : undefined })}
          {kind === "blockade" ? <>
            {text("lat", "Latitude", lat, setLat, { type: "number", errKey: "place" })}
            {text("lon", "Longitude", lon, setLon, { type: "number", errKey: "place" })}
            {text("radius", "Radius (km)", radius, setRadius, { type: "number" })}
            {text("highways", "Highways", highways, setHighways, { hint: "Comma-separated, e.g. MEX-57D, MEX-45D." })}
            {text("mult", "Transit effect (×)", mult, setMult, { type: "number", hint: "2 = transit takes twice as long. Estimated." })}
          </> : <>
            {text("countries", "Origin countries", countries, setCountries, { hint: "Two-letter codes, e.g. CN, KR.", errKey: "affects" })}
            {text("hs", "HS code prefixes", hs, setHs, { hint: "e.g. 8708, 8544.", errKey: "affects" })}
          </>}
        </div>
        <div className="admin-field">
          <label htmlFor="sig-description">Description</label>
          <textarea id="sig-description" className="ft-control admin-notes" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {err("title")}{err("dates")}{err("place")}{err("radius")}{err("mult")}{err("affects")}
        {serverError && <span className="admin-error" role="alert">Problem: {serverError}</span>}
      </fieldset>
      <div className="admin-actions">
        <Button type="submit" icon="check" disabled={!live || saving}>{saving ? "Saving signal…" : "Save signal"}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
