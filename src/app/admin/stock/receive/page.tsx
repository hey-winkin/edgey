import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminHeading, AdminLink, AdminNotice } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { makeDeliveryEditorState, makePurchaseReceiptState } from "@/lib/admin/delivery-editor-state";
import { deliveryToday } from "@/lib/admin/deliveries";
import { getPurchaseReceipt } from "@/lib/admin/purchase-order-data";
import { canManageCosts, stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { isWarehouseId } from "@/lib/admin/warehouse-format";
import { DeliveryEditor } from "./delivery-editor";
import { captureEarlyDeliveryText } from "./early-text";
import styles from "./delivery-editor.module.css";

export const metadata: Metadata = { title: "Receive delivery" };

export default async function ReceiveDeliveryPage({ searchParams }: { searchParams: Promise<{ po?: string }> }) {
  const { db, roles } = await requireStaff("warehouse");
  const { po } = await searchParams;
  if (po && !isWarehouseId(po)) notFound();
  const [{ error }, target] = await Promise.all([
    db.from("staff_deliveries").select("id").limit(1),
    po ? getPurchaseReceipt(db, po) : null,
  ]);
  if (error && !stockSchemaUnavailable(error)) throw new Error("Could not open delivery receiving.");
  if (target?.kind === "missing") notFound();
  const today = deliveryToday();
  const showCosts = canManageCosts(roles);
  const purchase = target?.kind === "open" ? target.order : null;
  const initial = purchase ? makePurchaseReceiptState(randomUUID(), today, purchase) : makeDeliveryEditorState(randomUUID(), today);

  return (
    <>
      <div className={styles.intro}>
        <AdminHeading
          title={purchase ? `Receive against ${purchase.number}` : "Receive delivery"}
          eyebrow="Warehouse / Stock"
          description={purchase
            ? "Confirm the quantities that actually arrived, then review any differences before updating stock."
            : "Record the blades that arrived together. Stock changes only after you review and receive the delivery."}
        />
        <nav className={styles.navigation} aria-label="Stock navigation">
          <AdminLink href="/admin/stock">Stock balances</AdminLink>
          <AdminLink href="/admin/stock/deliveries">Delivery history</AdminLink>
          {po && <AdminLink href={`/admin/purchase-orders/${po}`}>Purchase order</AdminLink>}
        </nav>
      </div>
      {target?.kind === "closed"
        ? <AdminNotice>{target.number} is not open for receiving.</AdminNotice>
        : target?.kind === "unavailable"
          ? <AdminNotice>Purchase-order receiving is not available yet.</AdminNotice>
        : error
        ? <AdminNotice>Delivery receiving is not available yet. Use Stock balances to receive individual blades.</AdminNotice>
        : <>
            <script dangerouslySetInnerHTML={{ __html: captureEarlyDeliveryText }} />
            <DeliveryEditor initial={initial} showCosts={showCosts && !purchase} today={today} />
          </>}
    </>
  );
}
