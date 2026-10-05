// "Why this colour": the risk drivers as bars on a 0–100 scale.
import { Card } from "../shared";
import { num } from "../../lib/format";
import type { RiskAssessment, Signal } from "../../lib/types";

export function DriversCard({ risk, signals }: { risk: RiskAssessment; signals: Signal[] }) {
  const drivers = [...risk.drivers].sort((a, b) => b.contribution - a.contribution);
  const sigOf = (id?: string) => (id ? signals.find((s) => s.id === id) : undefined);
  return (
    <Card title="Why this colour">
      {drivers.length === 0 ? <p className="supplier-risk-note">No risk drivers are active right now.</p> : (
        <ul className="supplier-risk-drivers">
          {drivers.map((d, i) => {
            const sig = sigOf(d.signalId);
            return (
              <li key={i} className="supplier-risk-driver">
                <div>
                  <span className="supplier-risk-driver-label">{d.label}</span>
                  {sig && <span className="supplier-risk-driver-src">{sig.title} · Source: {sig.source}</span>}
                </div>
                <div className="supplier-risk-bar" role="img" aria-label={`${d.contribution} points out of 100`}><i style={{ width: `${Math.max(0, Math.min(100, d.contribution))}%` }} /></div>
                <span className="supplier-risk-driver-pts ks-num">{num(d.contribution, d.contribution % 1 ? 1 : 0)} pts</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="supplier-risk-note">Bars are drawn on a 0 to 100 scale. Together the drivers make the score of {num(risk.score)}.</p>
    </Card>
  );
}
