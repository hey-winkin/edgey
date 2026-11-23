import type { Metadata } from "next";
import { AdminHeading, AdminLink, AdminNotice } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { deliveryToday } from "@/lib/admin/deliveries";
import { canManageCosts, stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { DeliveryEditor } from "./delivery-editor";
import styles from "./delivery-editor.module.css";

export const metadata: Metadata = { title: "Receive delivery" };

export default async function ReceiveDeliveryPage() {
  const { db, roles } = await requireStaff("warehouse");
  const { error } = await db.from("staff_deliveries").select("id").limit(1);
  if (error && !stockSchemaUnavailable(error)) throw new Error("Could not open delivery receiving.");

  return (
    <>
      <div className={styles.intro}>
        <AdminHeading
          title="Receive delivery"
          eyebrow="Warehouse / Stock"
          description="Record the blades that arrived together. Stock changes only after you review and receive the delivery."
        />
        <nav className={styles.navigation} aria-label="Stock navigation">
          <AdminLink href="/admin/stock">Stock balances</AdminLink>
          <AdminLink href="/admin/stock/deliveries">Delivery history</AdminLink>
        </nav>
      </div>
      {error
        ? <AdminNotice>Delivery receiving is not available yet. Use Stock balances to receive individual blades.</AdminNotice>
        : <DeliveryEditor showCosts={canManageCosts(roles)} today={deliveryToday()} />}
    </>
  );
}
