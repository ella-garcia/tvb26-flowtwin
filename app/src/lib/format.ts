// Number and date formatting. Mexico uses a comma for thousands and a dot for decimals.
const mxn0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "MXN", currencyDisplay: "symbol", maximumFractionDigits: 0 });

/** MX$12,000 */
export const mxn = (v: number) => mxn0.format(Math.round(v)).replace(/^MX\$|^\$/, "MX$");
/** MX$2.5M / MX$486k / MX$950 */
export function mxnShort(v: number): string {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}MX$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${s}MX$${Math.round(a / 1e3)}k`;
  return `${s}${mxn(a)}`;
}
/** 91.4% from 0.914 */
export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits).replace(/\.0$/, "")}%`;
export const num = (v: number, digits = 0) => v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
/** 41.2 t CO₂e */
export const tco2e = (v: number) => `${num(v, v < 100 ? 1 : 0)} t CO₂e`;
/** 30 Sep 2026 */
export const date = (iso: string) => new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
/** Row numbers are zero-padded: 01, 02 … */
export const rowNo = (i: number) => String(i + 1).padStart(2, "0");

/** Format a KPI value by its pack unit. */
export function kpi(value: number, unit: string): string {
  switch (unit) {
    case "%": return pct(value);
    case "days": return `${num(value, 1)} days`;
    case "MXN": return mxnShort(value);
    case "ppm": return `${num(value)} ppm`;
    case "t CO2e": return tco2e(value);
    case "level": return `Level ${num(value)}`;
    default: return num(value, 1);
  }
}
