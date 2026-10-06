// Alerts about this supplier, for the key customer.
import { useApp } from "../../app/AppContext";
import { AlertStatusPill, Card } from "../shared";
import type { Alert } from "../../lib/types";

export function RelatedAlerts({ alerts }: { alerts: Alert[] }) {
  const { go } = useApp();
  return (
    <Card title="Related alerts" actions={<button type="button" className="ft-linkbtn" onClick={() => go("alerts")}>View all alerts</button>}>
      {alerts.length === 0 ? <p className="supplier-risk-note">No alerts for this supplier.</p> : (
        <ul className="supplier-risk-alerts">
          {alerts.map((a) => (
            <li key={a.id}>
              <span>{a.title}</span>
              <AlertStatusPill status={a.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
