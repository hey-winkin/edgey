import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminHeading, AdminLink, AdminNotice, AdminSection } from "@/app/admin/ui";
import { WarehousePagination } from "@/app/admin/warehouse/pagination";
import { requireStaff } from "@/lib/admin/auth";
import { makeDeliveryEditorState, makePurchaseReceiptState } from "@/lib/admin/delivery-editor-state";
import { deliveryToday } from "@/lib/admin/deliveries";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { getPurchaseReceipt } from "@/lib/admin/purchase-order-data";
import { canManageCosts, stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { dispatchDate, isWarehouseId, warehousePage, warehousePageSize } from "@/lib/admin/warehouse-format";
import { DeliveryEditor } from "./delivery-editor";
import { captureEarlyDeliveryText } from "./early-text";
import { purchaseReceiptHref, receiveDeliveryHref, standaloneDeliveryHref } from "./routes";
import styles from "./delivery-editor.module.css";

export const metadata: Metadata = { title: staffDestinationLabels.bookInDelivery };

const units = new Intl.NumberFormat("en-GB");
const standaloneTitle = "Receive without a purchase order";

export default async function ReceiveDeliveryPage({ searchParams }: {
  searchParams: Promise<{ po?: string | string[]; view?: string | string[]; page?: string | string[] }>;
}) {
  const { db, roles } = await requireStaff("warehouse");
  const { po, view, page: requestedPage } = await searchParams;
  if (po && !isWarehouseId(po)) notFound();
  const chooser = !po && view !== "standalone";
  const page = warehousePage(requestedPage);
  const first = (page - 1) * warehousePageSize;
  const [{ error }, target, orders] = await Promise.all([
    db.from("staff_deliveries").select("id").limit(1),
    po ? getPurchaseReceipt(db, po) : null,
    chooser ? db.from("staff_purchase_orders")
      .select("id,number,ordered_on,expected_on,staff_purchase_order_lines(quantity,received_quantity)")
      .in("status", ["sent", "part_received"])
      .order("expected_on", { nullsFirst: false }).order("ordered_on", { ascending: false }).order("id")
      .range(first, first + warehousePageSize) : null,
  ]);
  if (error && !stockSchemaUnavailable(error)) throw new Error("Could not open delivery receiving.");
  if (target?.kind === "missing") notFound();
  if (orders?.error && !stockSchemaUnavailable(orders.error)) throw new Error("Could not load purchase orders for receiving.");
  const purchase = target?.kind === "open" ? target.order : null;

  const heading = (
    <div>
      <AdminHeading
        title={purchase ? `Receive against ${purchase.number}`
          : chooser || po ? staffDestinationLabels.bookInDelivery : standaloneTitle}
        eyebrow="Warehouse / Stock"
        description={purchase
          ? "Confirm the quantities that actually arrived, then review any differences before updating stock."
          : chooser ? "Choose the purchase order for this delivery to start with the quantities still due."
            : po ? undefined : "Only use this for deliveries without a purchase order. Review the lines before updating stock."}
      />
      <nav className={styles.navigation} aria-label="Stock navigation">
        {!chooser && <AdminLink href={receiveDeliveryHref}>Back to receiving options</AdminLink>}
        <AdminLink href="/admin/stock">{staffDestinationLabels.adjustStock}</AdminLink>
        <AdminLink href="/admin/stock/deliveries">{staffDestinationLabels.deliveryHistory}</AdminLink>
        {po && <AdminLink href={`/admin/purchase-orders/${po}`}>Purchase order</AdminLink>}
      </nav>
    </div>
  );

  if (error) return <>{heading}<AdminNotice>Delivery receiving is not available yet.</AdminNotice></>;
  if (target?.kind === "closed") return <>{heading}<AdminNotice>{target.number} is not open for receiving.</AdminNotice></>;
  if (target?.kind === "unavailable") return <>{heading}<AdminNotice>Purchase-order receiving is not available yet.</AdminNotice></>;

  if (chooser) {
    const openOrders = orders?.data?.slice(0, warehousePageSize).map(({ staff_purchase_order_lines: lines, ...order }) => ({
      ...order,
      outstanding: lines.reduce((total, line) => total + Math.max(0, line.quantity - line.received_quantity), 0),
    })).filter((order) => order.outstanding > 0) ?? [];
    return (
      <>
        {heading}
        <AdminSection title="Purchase orders awaiting delivery">
          {orders?.error ? <AdminNotice>Purchase orders are not available yet.</AdminNotice>
            : openOrders.length ? (
              <ul className={styles.purchaseOrders} role="list">
                {openOrders.map((order) => (
                  <li key={order.id}>
                    <AdminLink href={purchaseReceiptHref(order.id)}>{order.number}</AdminLink>
                    <p className="admin-muted">Ordered <time dateTime={order.ordered_on}>{dispatchDate(order.ordered_on)}</time></p>
                    <p className="admin-muted">{order.expected_on
                      ? <>Expected <time dateTime={order.expected_on}>{dispatchDate(order.expected_on)}</time></>
                      : "No expected date"}</p>
                    <p className="admin-mono">{units.format(order.outstanding)} {order.outstanding === 1 ? "unit" : "units"} outstanding</p>
                  </li>
                ))}
              </ul>
            ) : <AdminNotice>No purchase orders with units outstanding on this page.</AdminNotice>}
          {!orders?.error && <WarehousePagination href={receiveDeliveryHref} page={page}
            hasMore={(orders?.data?.length ?? 0) > warehousePageSize} label="Receiving pages" />}
        </AdminSection>
        <AdminSection title="No purchase order">
          <p className="admin-muted">Only use this option if there’s no purchase order for the delivery.</p>
          <div className={styles.navigation}><AdminLink href={standaloneDeliveryHref}>{standaloneTitle}</AdminLink></div>
        </AdminSection>
      </>
    );
  }

  const today = deliveryToday();
  return (
    <>
      {heading}
      <script dangerouslySetInnerHTML={{ __html: captureEarlyDeliveryText }} />
      <DeliveryEditor
        key={purchase?.id ?? "standalone"}
        initial={purchase ? makePurchaseReceiptState(randomUUID(), today, purchase) : makeDeliveryEditorState(randomUUID(), today)}
        permalink={purchase ? purchaseReceiptHref(purchase.id) : standaloneDeliveryHref}
        showCosts={!purchase && canManageCosts(roles)}
        today={today}
      />
    </>
  );
}
