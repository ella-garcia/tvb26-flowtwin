// 12-week outlook: weekly levels from signals known in advance. Shape + word, never colour alone.
import { date, num } from "../../lib/format";
import type { OutlookWeek } from "../../lib/types";
import "./outlook.css";

const WORD: Record<OutlookWeek["level"], string> = { red: "High", amber: "Watch", green: "OK" };
const SYMBOL: Record<OutlookWeek["level"], string> = { red: "▲", amber: "◆", green: "●" };
const short = (iso: string) => date(iso).replace(/ \d{4}$/, "");

function cellLabel(w: OutlookWeek) {
  const why = w.signals.length ? `: ${w.signals.join(", ")}` : "";
  return `Week of ${date(w.weekStart)}, ${WORD[w.level]}, about ${num(w.extraDays, 1)} extra days${why}`;
}

export function OutlookCell({ w }: { w: OutlookWeek }) {
  return <span className={`outlook-cell outlook-${w.level}`} role="img" aria-label={cellLabel(w)} title={cellLabel(w)}>{SYMBOL[w.level]}</span>;
}

/** Suppliers × weeks grid for the risk board. */
export function OutlookGrid({ rows, onOpen }: { rows: { id: string; name: string; outlook: OutlookWeek[] }[]; onOpen: (id: string) => void }) {
  const weeks = rows.find((r) => r.outlook.length)?.outlook ?? [];
  if (!weeks.length) return <p className="outlook-note">No outlook yet. It appears after the next risk calculation.</p>;
  return (
    <div className="outlook-scroll">
      <table className="outlook-grid">
        <caption className="outlook-sr">12-week outlook by supplier</caption>
        <thead><tr><th scope="col">Supplier</th>{weeks.map((w) => <th scope="col" key={w.weekStart}>{short(w.weekStart)}</th>)}</tr></thead>
        <tbody>
          {rows.filter((r) => r.outlook.length).map((r) => (
            <tr key={r.id}>
              <th scope="row"><button type="button" className="ft-linkbtn" onClick={() => onOpen(r.id)}>{r.name}</button></th>
              {r.outlook.map((w) => <td key={w.weekStart}><OutlookCell w={w} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OutlookLegend() {
  return (
    <ul className="outlook-legend" aria-label="Outlook legend">
      <li><span className="outlook-cell outlook-red" aria-hidden="true">▲</span>High: the expected delay would use up the cover of a critical part</li>
      <li><span className="outlook-cell outlook-amber" aria-hidden="true">◆</span>Watch: a day or more of delay, or half the cover</li>
      <li><span className="outlook-cell outlook-green" aria-hidden="true">●</span>OK</li>
    </ul>
  );
}

/** One supplier: the strip plus the weeks that need attention. */
export function OutlookDetail({ weeks }: { weeks: OutlookWeek[] }) {
  const flagged = weeks.filter((w) => w.level !== "green");
  return (
    <div className="outlook-detail">
      <div className="outlook-strip">
        {weeks.map((w) => (
          <div key={w.weekStart} className="outlook-week"><OutlookCell w={w} /><small>{short(w.weekStart)}</small></div>
        ))}
      </div>
      {flagged.length === 0 ? <p className="outlook-note">No known seasonal or announced risks in the next 12 weeks.</p> : (
        <ul className="outlook-reasons">
          {flagged.map((w) => (
            <li key={w.weekStart}>
              <b>Week of {date(w.weekStart)}</b> · {WORD[w.level]} · transit about <span className="ks-num">{num(w.expectedTransitDays, 1)}</span> days
              (+{num(w.extraDays, 1)}){w.signals.length > 0 && <> · {w.signals.join(", ")}</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const OUTLOOK_FORMULA = "Per week: the largest expected delay from signals active that week (route legs weighted like the 14-day projection), compared with the lowest days of cover of the supplier's critical parts. High if the delay would use up that cover; Watch if it uses half of it or is a day or more. Only signals known in advance count (seasonal patterns, announced events), so the outlook cannot foresee unannounced disruptions; alerts and line stops still come from the 14-day projection.";
