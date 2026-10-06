// Number and date formatting. Mexico uses a comma for thousands and a dot for decimals.
const mxn0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "MXN", currencyDisplay: "symbol", maximumFractionDigits: 0 });

/** MX$12,000 */
export const mxn = (v: number) => mxn0.format(Math.round(v)).replace(/^MX\$|^\$/, "MX$");
/** Unit prices keep centavos below MX$100: MX$0.62, MX$44.00, MX$1,250 */
export const mxnUnit = (v: number) => (v < 100 ? `MX$${v.toFixed(2)}` : mxn(v));
/** 91.4% from 0.914 */
export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits).replace(/\.0$/, "")}%`;
export const num = (v: number, digits = 0) => v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
/** 30 Sep 2026 */
export const date = (iso: string) => new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
/** 5 Oct 2026, 14:30 (local time) */
export const dateTime = (iso: string) =>
  `${date(iso)}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
/** 1 day / 2 days / 2.5 days */
export const days = (n: number) => `${num(n, n % 1 ? 1 : 0)} ${n === 1 ? "day" : "days"}`;
/** The word that goes with a risk light: Act now / Watch / OK. */
export const riskWord = (level: "green" | "amber" | "red") => (level === "red" ? "Act now" : level === "amber" ? "Watch" : "OK");
/** Row numbers are zero-padded: 01, 02 … */
export const rowNo = (i: number) => String(i + 1).padStart(2, "0");
