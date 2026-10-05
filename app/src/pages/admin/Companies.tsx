// Admin: the public company directory. No risks, costs or operating data are read here.
import { useApp } from "../../app/AppContext";
import { useScoped } from "../../lib/useScoped";
import type { Company } from "../../lib/types";
import { DataTable, StatusPill, type Column } from "../../keystone";
import { PageHeader, ScopedError } from "../../components/shared";
import { segmentLabel } from "../../packs";
import { rowNo } from "../../lib/format";

const SIZE: Record<Company["sizeBand"], string> = { micro: "Micro", small: "Small", medium: "Medium", large: "Large" };

export default function CompaniesPage() {
  const { db, pack } = useApp();
  const read = useScoped(() => db.companies(), [db]);
  const head = <PageHeader title="Companies" caption="Everyone on the platform. Admins see names and places only, never risks or costs." />;
  if (!read.ok) return <>{head}<ScopedError error={read.error} /></>;

  // Relationships are private to each supplier, so the admin view derives the segment from the company kind:
  // key customers are direct suppliers of the brand; suppliers invited by them sit one step below.
  const segment = (c: Company) => segmentLabel(pack, c.kind === "customer" ? "direct" : "sub", c.sizeBand);
  const cols: Column<Company>[] = [
    { key: "no", label: "No.", numeric: true, render: (_r, i) => rowNo(i) },
    { key: "name", label: "Company", render: (r) => r.name },
    { key: "city", label: "City", render: (r) => `${r.city}, ${r.state}` },
    { key: "kind", label: "Kind", render: (r) => <StatusPill tone={r.kind === "customer" ? "fresh" : "neutral"}>{r.kind === "customer" ? "Key customer" : "Supplier"}</StatusPill> },
    { key: "sizeBand", label: "Size", render: (r) => SIZE[r.sizeBand] },
    { key: "segment", label: "Segment", render: (r) => segment(r) },
    { key: "synthetic", label: "Synthetic", render: (r) => r.synthetic ? "Yes" : "No" },
  ];
  return <>{head}<DataTable columns={cols} rows={read.data} caption="Companies" /></>;
}
