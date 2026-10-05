// App shell: Keystone NavRail · SubNav · main area, plus the testing switcher that stands in for logins.
import { Breadcrumb, Icon, IconButton, NavRail, SubNav, UserChip, type RailItem } from "../keystone";
import { PACKS } from "../packs";
import type { PlanId, RoleId } from "../lib/types";
import { SyncBadge } from "../components/shared";
import { date } from "../lib/format";
import { useApp, type ModuleId } from "./AppContext";
import { MODULES } from "./routes";

const ROLE_LABEL: Record<RoleId, string> = { customer: "Key customer", owner: "Supplier owner", ops: "Supplier ops", admin: "Admin" };

// "supplier" is reached from the risk board (#supplier/<id>), so it is not on the rail.
const RAIL: Record<RoleId, ModuleId[]> = {
  customer: ["risk", "alerts", "invite"],
  owner: ["my-risk", "data"],
  ops: ["data", "my-risk"],
  admin: ["signals", "companies"],
};
const REACHABLE: Record<RoleId, ModuleId[]> = { ...RAIL, customer: [...RAIL.customer, "supplier"] };

function TestingBar() {
  const { toggles, setToggles, data, resetDemo, pack } = useApp();
  const companies = data.companies.filter((c) =>
    toggles.role === "customer" ? c.kind === "customer" : toggles.role === "admin" ? false : c.kind === "supplier");
  return (
    <div className="ft-testbar" role="region" aria-label="Testing switcher">
      <span className="ft-testbar-tag">Testing</span>
      <label>Industry
        <select id="tg-pack" value={toggles.packId} onChange={(e) => setToggles({ packId: e.target.value })}>
          {PACKS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label>Role
        <select id="tg-role" value={toggles.role} onChange={(e) => setToggles({ role: e.target.value as RoleId })}>
          {(Object.keys(ROLE_LABEL) as RoleId[]).map((r) =>
            <option key={r} value={r}>{r === "customer" ? `Key customer (${pack.labels.keyCustomer})` : ROLE_LABEL[r]}</option>)}
        </select>
      </label>
      <label>Company
        <select id="tg-company" value={toggles.companyId} disabled={toggles.role === "admin"}
          onChange={(e) => setToggles({ companyId: e.target.value })}>
          {toggles.role === "admin" && <option value="platform">FlowTwin platform</option>}
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.synthetic ? " (synthetic)" : ""}</option>)}
        </select>
      </label>
      <label>Plan
        <select id="tg-plan" value={toggles.plan} onChange={(e) => setToggles({ plan: e.target.value as PlanId })}>
          <option value="free">Free</option><option value="paid">Paid</option><option value="sponsored">Sponsored</option>
        </select>
      </label>
      <button type="button" className="ft-linkbtn" onClick={resetDemo}>Reset demo data</button>
    </div>
  );
}

export function Shell() {
  const { toggles, route, go, db } = useApp();
  const mod = MODULES[route.module] ?? MODULES[RAIL[toggles.role][0]];
  const allowed = REACHABLE[toggles.role].includes(route.module);
  const items: RailItem[] = RAIL[toggles.role].map((id) => ({ id, label: MODULES[id].label, icon: MODULES[id].icon }));
  const company = db.company(toggles.companyId);
  const supplierRole = toggles.role === "owner" || toggles.role === "ops";
  let twin;
  try { twin = supplierRole ? db.twin(toggles.companyId) : undefined; } catch { twin = undefined; }
  const Page = allowed ? mod.Page : MODULES[RAIL[toggles.role][0]].Page;
  const sub = mod.subnav?.();
  const person = company?.contact;

  return (
    <div className="ft-app">
      <TestingBar />
      <div className="ft-frame">
        <NavRail items={items} current={allowed ? (route.module === "supplier" ? "risk" : route.module) : RAIL[toggles.role][0]} onSelect={(id) => go(id as ModuleId)} />
        {sub && allowed && (
          <SubNav brand={["FlowTwin", company?.name ?? "Platform"]} items={sub.items} current={route.sub ?? sub.items[0]?.id}
            onSelect={(id) => go(route.module, id)} label={`${mod.label} sections`} />
        )}
        <main className="ft-main" id="main">
          <div className="ft-head">
            <Breadcrumb icon={mod.icon} items={[{ label: company?.name ?? "FlowTwin platform" }, { label: mod.label }]} />
            <div className="ft-head-right">
              {twin ? <SyncBadge syncedThrough={twin.syncedThrough} accuracy={twin.overallAccuracy} />
                : <span className="ft-sync"><Icon name="sync" size={16} />Risk updated {date(db.asOf)}</span>}
              <IconButton icon="bell" label="Notifications" />
              <UserChip name={person?.name ?? ROLE_LABEL[toggles.role]} email={person ? `${ROLE_LABEL[toggles.role]} · ${person.email}` : ROLE_LABEL[toggles.role]} />
            </div>
          </div>
          <Page />
        </main>
      </div>
    </div>
  );
}
