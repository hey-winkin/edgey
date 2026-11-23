import { AdminNotice } from "@/app/admin/ui";
import { CostFields } from "@/app/admin/cost-fields";
import { displayTimestamp } from "@/lib/admin/format";
import { formatSupplierCost } from "@/lib/admin/stock-cost";
import type { getCurrentStaffCost } from "@/lib/admin/stock-cost-data";
import { formatGbp } from "@/lib/commerce/money";
import { saveVariantCost } from "./cost-actions";
import { EditorForm } from "./editor-form";
import styles from "./editor.module.css";

export function VariantCost({ id, result }: { id: string; result: Awaited<ReturnType<typeof getCurrentStaffCost>> }) {
  const { available, cost } = result;
  const receipt = cost?.source === "receipt" && cost.stock_movement_id !== null
    ? { movementId: cost.stock_movement_id, recordedAt: cost.recorded_at }
    : null;
  const form = (
    <EditorForm id="variant-supplier-cost" action={saveVariantCost.bind(null, id, receipt)}
      submit={receipt ? "Save receipt cost correction" : "Save cost estimate"} receiptCorrection={Boolean(receipt)}>
      <p className="admin-muted">{receipt
        ? "This records a correction to the latest receipt’s costs. It does not change stock or erase the original entry."
        : "Margins use this estimate until you record a costed receipt."}</p>
      <CostFields cost={cost} />
    </EditorForm>
  );
  return (
    <section className={styles.costPanel} aria-labelledby="supplier-cost">
      <h3 id="supplier-cost">Supplier cost</h3>
      {!available ? <AdminNotice>Supplier costs will be available after the database update.</AdminNotice> : (
        <>
          {cost?.landed_unit_pence == null || cost.supplier_unit_minor == null || !cost.currency
            ? <AdminNotice>No cost recorded. Set an estimate or add a cost when receiving stock.</AdminNotice>
            : (
              <dl className="admin-spec">
                <dt>Cost source</dt><dd>{receipt ? "Latest costed receipt" : "Variant estimate"}</dd>
                <dt>Supplier price per blade</dt><dd className="admin-mono">{formatSupplierCost(cost.supplier_unit_minor, cost.currency)}</dd>
                <dt>Landed cost per blade</dt><dd className="admin-mono">{formatGbp(cost.landed_unit_pence)}</dd>
                <dt>Recorded</dt><dd><time dateTime={cost.recorded_at}>{displayTimestamp(cost.recorded_at)}</time></dd>
                {cost.stock_movement_id != null && <><dt>Stock receipt</dt><dd className="admin-mono">#{cost.stock_movement_id}</dd></>}
                {cost.exchange_rate != null && <><dt>Exchange rate</dt><dd className="admin-mono">{cost.exchange_rate} GBP per {cost.currency}</dd></>}
                {cost.freight_unit_pence != null && <><dt>Freight per blade</dt><dd className="admin-mono">{formatGbp(cost.freight_unit_pence)}</dd></>}
                {cost.duty_unit_pence != null && <><dt>Duty per blade</dt><dd className="admin-mono">{formatGbp(cost.duty_unit_pence)}</dd></>}
                {cost.note && <><dt>Cost note</dt><dd>{cost.note}</dd></>}
              </dl>
            )}
          {receipt && (
            <p className="admin-muted">Margins use this receipt’s landed cost. A receipt without a cost does not replace it.</p>
          )}
          {form}
        </>
      )}
    </section>
  );
}
