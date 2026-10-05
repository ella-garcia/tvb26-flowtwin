import { useApp } from "../../app/AppContext";
import { Breadcrumb } from "../../keystone";
import { Empty } from "../../components/shared";
import { SupplierRiskView } from "./SupplierRiskView";

export { SupplierRiskView } from "./SupplierRiskView";

export default function SupplierPage() {
  const { route, toggles, go } = useApp();
  const id = route.sub;
  const back = <Breadcrumb icon="pulse" items={[{ label: "Risk board", onClick: () => go("risk") }, { label: "Supplier risk" }]} />;
  if (!id) {
    return (
      <>
        {back}
        <Empty title="Choose a supplier" action={<button type="button" className="ft-linkbtn" onClick={() => go("risk")}>Open the risk board</button>}>
          Pick a supplier on the risk board to see why it is green, amber or red.
        </Empty>
      </>
    );
  }
  return (
    <>
      {back}
      <SupplierRiskView customerId={toggles.companyId} supplierId={id} audience="customer" />
    </>
  );
}
