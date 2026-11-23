import { notFound } from "next/navigation";
import { AdminHeading, AdminLink, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { canManageCosts, stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { dispatchDate, isWarehouseId, movementTime } from "@/lib/admin/warehouse-format";
import { formatGbp } from "@/lib/commerce/money";
import { addDeliveryLineCost } from "./actions";
import { DeliveryCostForm } from "./delivery-cost-form";
import styles from "../deliveries.module.css";

export default async function DeliveryRecord({ params }: { params: Promise<{ id: string }> }) {
  const { db, roles } = await requireStaff("warehouse", "catalogue", "finance");
  const { id } = await params;
  if (!isWarehouseId(id)) notFound();
  const warehouse = roles.includes("warehouse");
  const showCosts = canManageCosts(roles);
  const columns = "reference,received_on,received_at,note,line_count,unit_count";
  const [linked, lines] = await Promise.all([
    db.from("staff_deliveries").select(`${columns},staff_purchase_orders(id,number)`).eq("id", id).maybeSingle(),
    db.from("staff_delivery_lines").select("position,variant_id,sku,blade_name,quantity,stock_movement_id").eq("delivery_id", id).order("position"),
  ]);
  const delivery = linked.error && (linked.error.code === "PGRST200" || stockSchemaUnavailable(linked.error))
    ? await db.from("staff_deliveries").select(columns).eq("id", id).maybeSingle()
    : linked;
  if (delivery.error && stockSchemaUnavailable(delivery.error)) notFound();
  if (delivery.error || lines.error) throw new Error("Could not load the delivery record.");
  if (!delivery.data) notFound();
  const record = delivery.data;
  const order = linked.data?.staff_purchase_orders;
  const costs = new Map<number, number>();
  const movementIds = lines.data.map((line) => line.stock_movement_id);
  const canReadCosts = showCosts && movementIds.length > 0;
  const [effectiveCosts, breakdowns] = await Promise.all([
    canReadCosts ? db.from("staff_effective_receipt_costs")
      .select("stock_movement_id,landed_unit_pence").in("stock_movement_id", movementIds) : null,
    canReadCosts && order ? db.from("staff_purchase_receipt_cost_breakdowns")
      .select("stock_movement_id,base_unit_pence,freight_unit_pence,duty_unit_pence,other_unit_pence,vat_unit_pence,include_import_vat")
      .in("stock_movement_id", movementIds) : null,
  ]);
  if (effectiveCosts?.error) throw new Error("Could not load the delivery costs.");
  if (breakdowns?.error) throw new Error("Could not load the purchase-order cost breakdown.");
  const breakdownByMovement = new Map(breakdowns?.data?.map((row) => [row.stock_movement_id, row]));
  for (const cost of effectiveCosts?.data ?? []) {
    if (cost.stock_movement_id !== null && cost.landed_unit_pence !== null) costs.set(cost.stock_movement_id, cost.landed_unit_pence);
  }

  return (
    <>
      <AdminHeading title={record.reference} eyebrow="Warehouse / Delivery record" description="This delivery has been received into stock." />
      <nav className={styles.links} aria-label="Stock navigation">
        <AdminLink href="/admin/stock/deliveries">Delivery history</AdminLink>
        {warehouse && <AdminLink href="/admin/stock/receive">Receive another delivery</AdminLink>}
      </nav>
      <AdminSection title="Delivery details">
        <dl className={styles.summary}>
          <div><dt>Delivery date</dt><dd><time dateTime={record.received_on}>{dispatchDate(record.received_on)}</time></dd></div>
          <div><dt>Recorded</dt><dd><time dateTime={record.received_at}>{movementTime(record.received_at)}</time></dd></div>
          <div><dt>Lines</dt><dd>{record.line_count}</dd></div>
          <div><dt>Units received</dt><dd>{record.unit_count.toLocaleString("en-GB")}</dd></div>
          {order && <div><dt>Purchase order</dt><dd><AdminLink href={`/admin/purchase-orders/${order.id}`}>{order.number}</AdminLink></dd></div>}
        </dl>
        {record.note && <p className="admin-preserve-lines mt-3"><strong>Note: </strong>{record.note}</p>}
      </AdminSection>
      <AdminSection title="Received blades">
        <ol className={styles.ledger} role="list">
          {lines.data.map((line) => {
            const cost = costs.get(line.stock_movement_id);
            const breakdown = breakdownByMovement.get(line.stock_movement_id);
            return (
              <li className={styles.line} key={line.position}>
                <div>
                  <span className={styles.position} aria-hidden="true">{String(line.position).padStart(2, "0")} /</span>
                  <span className="admin-mono">
                    {warehouse ? <AdminLink href={`/admin/stock/${line.variant_id}`}>{line.sku}</AdminLink> : line.sku}
                  </span>
                  <p>{line.blade_name}</p>
                </div>
                <p className="admin-mono">{line.quantity.toLocaleString("en-GB")} {line.quantity === 1 ? "unit" : "units"}</p>
                {showCosts && (
                  <div className={styles.cost}>
                    {cost === undefined ? (
                      <>
                        <p className="admin-muted">Cost to be entered</p>
                        <DeliveryCostForm sku={line.sku} action={addDeliveryLineCost.bind(null, id, line.position)} />
                      </>
                    ) : <p><span className="admin-mono">{formatGbp(cost)}</span> per blade</p>}
                    {breakdown && <details>
                      <summary>Original purchase cost breakdown</summary>
                      <dl>
                        <div><dt>Blade</dt><dd>{formatGbp(breakdown.base_unit_pence)}</dd></div>
                        <div><dt>Shipping</dt><dd>{formatGbp(breakdown.freight_unit_pence)}</dd></div>
                        <div><dt>Duty</dt><dd>{formatGbp(breakdown.duty_unit_pence)}</dd></div>
                        <div><dt>Other</dt><dd>{formatGbp(breakdown.other_unit_pence)}</dd></div>
                        <div><dt>Import VAT</dt><dd>{formatGbp(breakdown.vat_unit_pence)}{breakdown.include_import_vat === false ? " · excluded" : ""}</dd></div>
                      </dl>
                      <p className="admin-muted">Components are rounded for display. The original landed total was rounded once.</p>
                    </details>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </AdminSection>
    </>
  );
}
