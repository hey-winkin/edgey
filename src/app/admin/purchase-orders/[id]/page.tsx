import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { canReceivePurchaseOrder, formatPurchaseAmount, purchaseStatusLabel } from "@/lib/admin/purchase-orders";
import { canManageCosts, stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { dispatchDate, isWarehouseId, movementTime } from "@/lib/admin/warehouse-format";
import { formatGbp } from "@/lib/commerce/money";
import { transitionPurchaseOrder } from "./actions";
import styles from "../purchase-orders.module.css";

const pathname = "/admin/purchase-orders";
const number = new Intl.NumberFormat("en-GB");
const eventLabel: Record<string, string> = {
  created: "Order drafted", draft_saved: "Draft updated", amended: "Order amended", sent: "Marked as sent",
  receipt: "Delivery received", closed: "Order closed", cancelled: "Order cancelled",
};

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, roles } = await requireStaff("warehouse", "catalogue", "finance");
  const { id } = await params;
  if (!isWarehouseId(id)) notFound();
  const showCosts = canManageCosts(roles);
  const [found, privateHeader, privateLines, events, deliveries] = await Promise.all([
    db.from("staff_purchase_orders").select("id,number,status,ordered_on,expected_on,revision,staff_purchase_order_lines(position,variant_id,sku,blade_name,option_label,quantity,received_quantity)")
      .eq("id", id).order("position", { referencedTable: "staff_purchase_order_lines" }).maybeSingle(),
    showCosts ? db.from("staff_purchase_order_costs")
      .select("currency,exchange_rate,shipping_minor,duty_minor,other_minor,import_vat_minor,include_import_vat,note,staff_suppliers(name)")
      .eq("purchase_order_id", id).maybeSingle() : null,
    showCosts ? db.from("staff_purchase_order_line_costs")
      .select("variant_id,unit_price_minor,supplier_part_number,note,base_unit_pence,freight_unit_pence,duty_unit_pence,other_unit_pence,vat_unit_pence,landed_unit_pence")
      .eq("purchase_order_id", id) : null,
    db.from("staff_purchase_order_events").select("id,kind,revision,created_at").eq("purchase_order_id", id).order("revision", { ascending: false }).limit(50),
    db.from("staff_deliveries").select("id,reference,received_on,unit_count").eq("purchase_order_id", id).order("received_at", { ascending: false }).limit(50),
  ]);
  if (found.error && stockSchemaUnavailable(found.error)) notFound();
  if (found.error || privateHeader?.error || privateLines?.error || events.error ||
      (deliveries.error && !stockSchemaUnavailable(deliveries.error))) throw new Error("Could not load the purchase order.");
  const order = found.data;
  if (!order || (!showCosts && order.status === "draft")) notFound();

  const lines = order.staff_purchase_order_lines;
  const costs = privateHeader?.data;
  const lineCosts = new Map(privateLines?.data?.map((line) => [line.variant_id, line]));
  const canReceive = canReceivePurchaseOrder(order.status);
  const canEdit = showCosts && (canReceive || order.status === "draft");
  const canCancel = showCosts && (order.status === "draft" || order.status === "sent");
  const canClose = showCosts && (canReceive || order.status === "received");
  const remaining = lines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.received_quantity), 0);
  const total = lines.every((line) => lineCosts.get(line.variant_id)?.unit_price_minor != null)
    ? lines.reduce((sum, line) => sum + BigInt(lineCosts.get(line.variant_id)!.unit_price_minor!) * BigInt(line.quantity), 0n)
    : null;

  return (
    <>
      <AdminHeading title={order.number}
        description={order.status === "draft" ? "Review the draft before sending it to the supplier." : purchaseStatusLabel[order.status]} />
      <nav className={styles.links} aria-label="Purchase order navigation">
        {canReceive && roles.includes("warehouse") && <Link className="primary" href={`/admin/stock/receive?po=${id}`}>Receive against this PO</Link>}
        <AdminLink href={pathname}>Purchase orders</AdminLink>
        {canEdit && <AdminLink href={`${pathname}/${id}/edit`}>{order.status === "draft" ? "Edit draft" : "Amend order"}</AdminLink>}
        {showCosts && <>
          <AdminLink href={`${pathname}/${id}/print`}>Printable PO</AdminLink>
          <AdminLink href={`${pathname}/${id}/export`}>Download PO CSV</AdminLink>
          <a className="textlink" href={`${pathname}/${id}/export/pdf`}>Download PDF</a>
        </>}
      </nav>
      <AdminSection title="Order details">
        <dl className={styles.summary}>
          <div><dt>Status</dt><dd>{purchaseStatusLabel[order.status]}</dd></div>
          <div><dt>Order date</dt><dd><time dateTime={order.ordered_on}>{dispatchDate(order.ordered_on)}</time></dd></div>
          <div><dt>Expected date</dt><dd>{order.expected_on ? <time dateTime={order.expected_on}>{dispatchDate(order.expected_on)}</time> : "Not set"}</dd></div>
          <div><dt>Units outstanding</dt><dd>{number.format(canReceive ? remaining : 0)}</dd></div>
          {costs && <>
            <div><dt>Supplier</dt><dd>{costs.staff_suppliers?.name ?? "Not selected"}</dd></div>
            <div><dt>Order currency</dt><dd>{costs.currency}</dd></div>
            <div><dt>Exchange rate</dt><dd>{costs.exchange_rate == null ? "Not set" : `£${costs.exchange_rate} per 1 ${costs.currency}`}</dd></div>
            <div><dt>Merchandise total</dt><dd>{total === null ? "Not priced" : formatPurchaseAmount(total, costs.currency)}</dd></div>
            <div><dt>Shipping</dt><dd>{formatPurchaseAmount(costs.shipping_minor, costs.currency)}</dd></div>
            <div><dt>Duty</dt><dd>{formatPurchaseAmount(costs.duty_minor, costs.currency)}</dd></div>
            <div><dt>Other extra costs</dt><dd>{formatPurchaseAmount(costs.other_minor, costs.currency)}</dd></div>
            <div><dt>Import VAT</dt><dd>{formatPurchaseAmount(costs.import_vat_minor, costs.currency)}{costs.include_import_vat !== null
              ? costs.include_import_vat ? " · Included in landed cost" : " · Excluded from landed cost" : ""}</dd></div>
          </>}
        </dl>
        {costs?.note && <p className="admin-preserve-lines mt-3"><strong>Note: </strong>{costs.note}</p>}
        {order.status === "draft" && showCosts && <div className={styles.actionPanel}>
          <AdminForm action={transitionPurchaseOrder.bind(null, id, order.revision, "sent")} submit="Mark as sent">
            <p className="admin-muted">This releases the final copy and adds the quantities to On order. Print or download it and send it yourself.</p>
          </AdminForm>
        </div>}
      </AdminSection>
      <AdminSection title="Order lines">
        {!lines.length ? <AdminNotice>No blades on this order yet.</AdminNotice> : (
          <ol className={styles.ledger} role="list">
            {lines.map((line) => {
              const amounts = lineCosts.get(line.variant_id);
              const outstanding = Math.max(0, line.quantity - line.received_quantity);
              return <li key={line.variant_id} className={styles.recordLine}>
                <div>
                  <p className="admin-mono">{line.sku}</p>
                  <p>{line.blade_name}{line.option_label ? ` · ${line.option_label}` : ""}</p>
                  {amounts?.supplier_part_number && <p className="admin-muted">Supplier part: {amounts.supplier_part_number}</p>}
                  {amounts?.note && <p className="admin-preserve-lines admin-muted">{amounts.note}</p>}
                </div>
                <dl className={styles.lineFacts}>
                  <div><dt>Ordered</dt><dd>{number.format(line.quantity)}</dd></div>
                  <div><dt>Received</dt><dd>{number.format(line.received_quantity)}</dd></div>
                  {canReceive && <div><dt>Outstanding</dt><dd>{number.format(outstanding)}</dd></div>}
                </dl>
                {costs && amounts && <div className={styles.linePrice}>
                  <p>Supplier unit price ex VAT: <span className="admin-mono">{amounts.unit_price_minor == null ? "Not set" : formatPurchaseAmount(amounts.unit_price_minor, costs.currency)}</span></p>
                  <p>Landed unit cost: <span className="admin-mono">{amounts.landed_unit_pence == null ? "Not calculated" : formatGbp(amounts.landed_unit_pence)}</span></p>
                  {amounts.landed_unit_pence !== null && <details className={styles.breakdown}>
                    <summary>Cost breakdown</summary>
                    <dl className={styles.lineFacts}>
                      <div><dt>Blade</dt><dd>{formatGbp(amounts.base_unit_pence ?? 0)}</dd></div>
                      <div><dt>Shipping</dt><dd>{formatGbp(amounts.freight_unit_pence ?? 0)}</dd></div>
                      <div><dt>Duty</dt><dd>{formatGbp(amounts.duty_unit_pence ?? 0)}</dd></div>
                      <div><dt>Other</dt><dd>{formatGbp(amounts.other_unit_pence ?? 0)}</dd></div>
                      <div><dt>Import VAT</dt><dd>{formatGbp(amounts.vat_unit_pence ?? 0)}{!costs.include_import_vat ? " · excluded" : ""}</dd></div>
                    </dl>
                    <p className="admin-muted">Components are rounded for display. The landed total is rounded once.</p>
                  </details>}
                </div>}
              </li>;
            })}
          </ol>
        )}
      </AdminSection>
      <AdminSection title="Received deliveries">
        {deliveries.data?.length ? <ul className={styles.ledger} role="list">
          {deliveries.data.map((delivery) => <li key={delivery.id} className={styles.indexRow}>
            <AdminLink href={`/admin/stock/deliveries/${delivery.id}`}>{delivery.reference}</AdminLink>
            <time dateTime={delivery.received_on}>{dispatchDate(delivery.received_on)}</time>
            <span>{number.format(delivery.unit_count)} units</span>
          </li>)}
        </ul> : <AdminNotice>No deliveries recorded against this order.</AdminNotice>}
      </AdminSection>
      <AdminSection title="Activity">
        {events.data.length ? <ol className={styles.ledger} role="list">
          {events.data.map((event) => <li key={event.id} className={styles.indexRow}>
            <span>{eventLabel[event.kind] ?? "Order updated"}</span><time dateTime={event.created_at}>{movementTime(event.created_at)}</time>
            <span className="admin-mono">Revision {event.revision}</span>
          </li>)}
        </ol> : <AdminNotice>No activity recorded.</AdminNotice>}
      </AdminSection>
      {(canCancel || canClose) && <AdminSection title="Order actions">
        <div className={styles.actions}>
          {canCancel && <AdminForm action={transitionPurchaseOrder.bind(null, id, order.revision, "cancelled")} submit="Cancel purchase order"
            confirmation={{ description: "This stops you receiving against the purchase order and removes its outstanding quantities from On order.", label: "I confirm that this order should be cancelled" }} />}
          {canClose && <AdminForm action={transitionPurchaseOrder.bind(null, id, order.revision, "closed")} submit="Close purchase order"
            confirmation={{ description: remaining > 0
              ? `${number.format(remaining)} outstanding units will no longer be expected. Stock already received stays in inventory.`
              : "The purchase order will be closed. Stock already received stays in inventory.", label: "I confirm that no further deliveries are expected" }} />}
        </div>
      </AdminSection>}
    </>
  );
}
