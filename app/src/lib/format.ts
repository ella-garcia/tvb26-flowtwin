// Number and date formatting. Mexico uses a comma for thousands and a dot for decimals.
const mxn0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "MXN", currencyDisplay: "symbol", maximumFractionDigits: 0 });

/** MX$12,000 */
export const mxn = (v: number) => mxn0.format(Math.round(v)).replace(/^MX\$|^\$/, "MX$");
/** 91.4% from 0.914 */
export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits).replace(/\.0$/, "")}%`;
export const num = (v: number, digits = 0) => v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
/** 30 Sep 2026 */
export const date = (iso: string) => new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
/** Row numbers are zero-padded: 01, 02 … */
export const rowNo = (i: number) => String(i + 1).padStart(2, "0");
