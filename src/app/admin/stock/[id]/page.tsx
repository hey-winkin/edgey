import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { formatSupplierCost, isStockAdjustmentReason, stockAdjustmentReasons } from "@/lib/admin/stock-cost";
import { canManageCosts, getStaffReceiptCosts } from "@/lib/admin/stock-cost-data";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { getStockVariant } from "@/lib/admin/warehouse";
import { runWarehouseAction } from "@/lib/admin/warehouse-actions";
import { isWarehouseId, movementTime, warehouseLabel, warehousePage } from "@/lib/admin/warehouse-format";
import { formatGbp } from "@/lib/commerce/money";
import { WarehousePagination } from "../../warehouse/pagination";
import { receiveDeliveryHref } from "../receive/routes";

function delta(value: number) {
  return value > 0 ? `+${value}` : value;
}

export default async function StockVariantPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { db, roles } = await requireStaff("warehouse");
  const { id } = await params;
  if (!isWarehouseId(id)) notFound();
  const page = warehousePage((await searchParams).page);
  const result = await getStockVariant(db, id, page);
  if (!result) notFound();
  const { variant, movements, hasMore, adjustmentsAvailable } = result;
  const showCosts = adjustmentsAvailable && canManageCosts(roles);
  const costs = showCosts
    ? await getStaffReceiptCosts(db, roles, id, movements.filter(({ kind }) => kind === "receive").map(({ id }) => id))
    : [];
  const costsByMovement = new Map(costs.map((cost) => [cost.stock_movement_id, cost]));

  return (
    <>
      <AdminHeading title={variant.sku} eyebrow="Stock variant" description={variant.option_label || variant.tool || undefined} />
      <div><AdminLink href="/admin/stock">{staffDestinationLabels.adjustStock}</AdminLink></div>
      <AdminSection title="Current balance">
        <dl className="admin-spec">
          <dt>On hand</dt><dd className="admin-mono">{variant.stock_on_hand}</dd>
          <dt>Reserved</dt><dd className="admin-mono">{variant.stock_reserved}</dd>
          <dt>Available</dt><dd className="admin-mono">{variant.stock_on_hand - variant.stock_reserved}</dd>
          <dt>Catalogue status</dt><dd>{warehouseLabel(variant.publication_status)}</dd>
        </dl>
      </AdminSection>
      <AdminSection title="Receive stock">
        <p className="admin-muted mb-2">Book this blade in with the rest of the delivery.</p>
        <AdminLink href={receiveDeliveryHref}>{staffDestinationLabels.bookInDelivery}</AdminLink>
      </AdminSection>
      <AdminSection title="Adjust stock">
        {adjustmentsAvailable ? (
          <AdminForm action={runWarehouseAction.bind(null, { kind: "adjust", variantId: variant.id, key: randomUUID() })} submit="Record stock adjustment">
            <p>Enter a negative number to take units off the books, or a positive number to add missing units from a count. You can’t remove units reserved for orders or trial packs. To fix a mistake, record a new adjustment.</p>
            <div className="admin-grid">
              <AdminField label="Quantity change">
                <input name="quantity" placeholder="For example, -2 or +3" maxLength={11} required />
              </AdminField>
              <AdminField label="Adjustment reason">
                <select name="reason" defaultValue="" required>
                  <option value="" disabled>Choose a reason</option>
                  {Object.entries(stockAdjustmentReasons).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </AdminField>
            </div>
            <AdminField label="Adjustment note (required for Other)">
              <textarea name="adjustmentNote" maxLength={500} rows={2} />
            </AdminField>
          </AdminForm>
        ) : <AdminNotice>Stock adjustments will be available after the database update.</AdminNotice>}
      </AdminSection>
      <AdminSection title="Movement ledger">
        {movements.length ? (
          <AdminTable label="Movement ledger" headers={["Recorded", "Movement", "On-hand change", "Reserved change", "Reference", ...(showCosts ? ["Receipt cost per blade"] : [])]}>
            {movements.map((entry) => {
              const cost = costsByMovement.get(entry.id);
              const reason = entry.adjustment_reason;
              return (
                <tr key={entry.id}>
                  <td className="admin-mono"><time dateTime={entry.created_at}>{movementTime(entry.created_at)}</time></td>
                  <td>{entry.kind === "adjust" ? "Adjustment" : warehouseLabel(entry.kind)}</td>
                  <td className="admin-mono">{delta(entry.on_hand_delta)}{entry.on_hand_before !== null && entry.on_hand_after !== null &&
                    <div className="admin-muted">{entry.on_hand_before} → {entry.on_hand_after}</div>}</td>
                  <td className="admin-mono">{delta(entry.reserved_delta)}{entry.reserved_before !== null && entry.reserved_after !== null &&
                    <div className="admin-muted">{entry.reserved_before} → {entry.reserved_after}</div>}</td>
                  <td>
                    {reason && isStockAdjustmentReason(reason) ? <>{stockAdjustmentReasons[reason]}{entry.adjustment_note && <div>{entry.adjustment_note}</div>}</>
                      : entry.return_id ? <span className="admin-mono break-all">Return {entry.return_id}</span>
                        : entry.trial_request_id ? <span className="admin-mono break-all">Trial {entry.trial_request_id}</span>
                          : entry.order_id ? <span className="admin-mono break-all">Order {entry.order_id}</span>
                            : entry.kind === "receive" ? <span className="admin-mono">Receipt #{entry.id}</span> : "—"}
                    {entry.actor_id && <div className="admin-muted break-all">Staff: {entry.actor_id}</div>}
                  </td>
                  {showCosts && <td className="admin-mono">{cost
                    ? <>{formatGbp(cost.landed_unit_pence)} landed<div className="admin-muted">{formatSupplierCost(cost.supplier_unit_minor, cost.currency)} supplier</div></>
                    : entry.kind === "receive" ? "Not recorded" : "—"}</td>}
                </tr>
              );
            })}
          </AdminTable>
        ) : <AdminNotice>No stock movements found on this page.</AdminNotice>}
        <WarehousePagination href={`/admin/stock/${variant.id}`} page={page} hasMore={hasMore} label="Movement pages" />
      </AdminSection>
    </>
  );
}
