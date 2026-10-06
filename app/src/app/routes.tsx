// Route registry. Each module's page lives in src/pages/<module>/ and is owned by one builder.
import type { ComponentType } from "react";
import type { IconName, SubNavItem } from "../keystone";
import type { ModuleId } from "./AppContext";
import RiskBoardPage from "../pages/risk";
import AlertsPage from "../pages/alerts";
import PartsPage from "../pages/parts";
import WhatIfPage from "../pages/what-if";
import SupplierPage from "../pages/supplier";
import InvitePage from "../pages/invite";
import MyRiskPage from "../pages/my-risk";
import Tier1DataPage from "../pages/tier1-data";
import DataPage from "../pages/data";
import SignalsPage from "../pages/admin/Signals";
import CompaniesPage from "../pages/admin/Companies";

export interface ModuleDef {
  label: string;
  icon: IconName;
  Page: ComponentType;
  /** Optional second column. Called inside the shell, so it may use hooks. */
  subnav?: () => { items: SubNavItem[] } | undefined;
}

export const MODULES: Record<ModuleId, ModuleDef> = {
  risk: { label: "Risk board", icon: "pulse", Page: RiskBoardPage },
  parts: { label: "Parts & stock", icon: "cube", Page: PartsPage },
  "what-if": { label: "What-if", icon: "sliders", Page: WhatIfPage },
  alerts: { label: "Alerts", icon: "bell", Page: AlertsPage },
  supplier: { label: "Supplier", icon: "users", Page: SupplierPage },
  invite: { label: "Invite", icon: "plus", Page: InvitePage },
  "tier1-data": { label: "Data", icon: "upload", Page: Tier1DataPage },
  "my-risk": { label: "My risk", icon: "pulse", Page: MyRiskPage },
  data: { label: "My data", icon: "upload", Page: DataPage },
  signals: { label: "Signals", icon: "map", Page: SignalsPage },
  companies: { label: "Companies", icon: "bank", Page: CompaniesPage },
};
