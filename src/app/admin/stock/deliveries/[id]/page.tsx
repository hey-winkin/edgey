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
  const [delivery, lines] = await Promise.all([
    db.from("staff_deliveries").select("reference,received_on,received_at,note,line_count,unit_count").eq("id", id).maybeSingle(),
    db.from("staff_delivery_lines").select("position,variant_id,sku,blade_name,quantity,stock_movement_id").eq("delivery_id", id).order("position"),
  ]);
  if (delivery.error && stockSchemaUnavailable(delivery.error)) notFound();
  if (delivery.error || lines.error) throw new Error("Could not load the delivery record.");
  if (!delivery.data) notFound();
  const record = delivery.data;
  const costs = new Map<number, number>();
  if (showCosts && lines.data.length) {
    const { data, error } = await db.from("staff_effective_receipt_costs")
      .select("stock_movement_id,landed_unit_pence").in("stock_movement_id", lines.data.map((line) => line.stock_movement_id));
    if (error) throw new Error("Could not load the delivery costs.");
    for (const cost of data) {
      if (cost.stock_movement_id !== null && cost.landed_unit_pence !== null) costs.set(cost.stock_movement_id, cost.landed_unit_pence);
    }
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
        </dl>
        {record.note && <p className="admin-preserve-lines mt-3"><strong>Note: </strong>{record.note}</p>}
      </AdminSection>
      <AdminSection title="Received blades">
        <ol className={styles.ledger} role="list">
          {lines.data.map((line) => {
            const cost = costs.get(line.stock_movement_id);
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
