// Transit by route leg (road, border, customs, port): where the days pile up. Only for routes with more than one leg.
import { Card, FormulaSource } from "../shared";
import { num } from "../../lib/format";
import type { Provenance, TransitLeg } from "../../lib/types";

const KIND_WORD: Record<TransitLeg["kind"], string> = { road: "Road", border: "Border", customs: "Customs", port: "Port", sea: "Sea" };
const W = 560, BAR = 22, GAP = 18, LABEL = 92, TOP = 4;

function Bar({ legs, value, y, max }: { legs: TransitLeg[]; value: (l: TransitLeg) => number; y: number; max: number }) {
  const scale = (W - LABEL - 8) / max;
  let x = LABEL;
  return (
    <>
      {legs.map((l, i) => {
        const w = Math.max(0, value(l) * scale);
        const r = <rect key={i} className={`supplier-risk-leg supplier-risk-leg-${l.kind}`} x={x} y={y} width={w} height={BAR}><title>{`${l.label}: ${num(value(l), 1)} days`}</title></rect>;
        x += w;
        return r;
      })}
    </>
  );
}

export function RouteCard({ legs, provenance }: { legs: TransitLeg[]; provenance: Provenance }) {
  const normal = legs.reduce((a, l) => a + l.normalDays, 0);
  const expected = legs.reduce((a, l) => a + l.expectedDays, 0);
  const max = Math.max(normal, expected, 1);
  const H = TOP + 2 * BAR + GAP + 22;
  const ticks = Array.from({ length: Math.floor(max) + 1 }, (_, i) => i).filter((t) => max <= 8 || t % 2 === 0);
  const scale = (W - LABEL - 8) / max;
  return (
    <Card title="Route and transit by leg">
      <svg className="supplier-risk-route" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Normal transit ${num(normal, 1)} days, expected ${num(expected, 1)} days, by leg`}>
        <text className="supplier-risk-axis" x={0} y={TOP + BAR / 2 + 4}>Normal</text>
        <Bar legs={legs} value={(l) => l.normalDays} y={TOP} max={max} />
        <text className="supplier-risk-axis" x={0} y={TOP + BAR + GAP + BAR / 2 + 4}>Expected</text>
        <Bar legs={legs} value={(l) => l.expectedDays} y={TOP + BAR + GAP} max={max} />
        {ticks.map((t) => (
          <text key={t} className="supplier-risk-axis" x={LABEL + t * scale} y={H - 4} textAnchor="middle">{t}</text>
        ))}
      </svg>
      <ul className="supplier-risk-legs">
        {legs.map((l, i) => {
          const extra = l.expectedDays - l.normalDays;
          return (
            <li key={i}>
              <svg width="12" height="12" aria-hidden="true"><rect className={`supplier-risk-leg supplier-risk-leg-${l.kind}`} width="12" height="12" rx="2" /></svg>
              <span><b>{KIND_WORD[l.kind]}</b> · {l.label}, {l.place}</span>
              <span className="ks-num">{num(l.normalDays, 1)} → {num(l.expectedDays, 1)} days
                {extra >= 0.05 && <em className="supplier-risk-leg-up"> ▲ {num(extra, 1)}</em>}</span>
            </li>
          );
        })}
      </ul>
      <FormulaSource
        formula="Each leg's expected time = its normal time × the signals that reach that leg (customs and border outages hit border and customs legs; road closures and blockades hit road legs by highway; weather hits any leg in range), median over the next 14 days. The legs add up to the route's transit; the projection above adds day-to-day variability."
        data="Route legs and normal times from the supplier profile; active signals from the Signals page."
        provenance={provenance} />
    </Card>
  );
}
