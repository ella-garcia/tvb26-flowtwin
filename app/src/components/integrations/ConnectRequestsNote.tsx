// Supplier, Data page: customers that asked this supplier to connect its systems.
import { useApp } from "../../app/AppContext";
import { date } from "../../lib/format";
import "./integrations.css";

export function ConnectRequestsNote({ supplierId }: { supplierId: string }) {
  const { db } = useApp();
  const open = db.requests().filter((r) => r.toCompanyId === supplierId && r.items.includes("connect-systems") && r.status === "open");
  if (open.length === 0) return null;
  const who = open.map((r) => `${db.company(r.fromCompanyId)?.name ?? r.fromCompanyId} (${date(r.sentAt)})`).join(", ");
  return (
    <p className="int-note" role="note">
      <b>{open.length === 1 ? "Your customer asked" : "Your customers asked"} you to connect your systems:</b> {who}.
      It's free for you. Request a system below and the FlowTwin team will set it up with you.
    </p>
  );
}
