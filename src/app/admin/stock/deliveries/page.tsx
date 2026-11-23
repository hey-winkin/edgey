import { AdminHeading, AdminLink, AdminNotice, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { dispatchDate, warehousePage, warehousePageSize } from "@/lib/admin/warehouse-format";
import { WarehousePagination } from "../../warehouse/pagination";
import styles from "./deliveries.module.css";

export default async function DeliveryHistory({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { db, roles } = await requireStaff("warehouse", "catalogue", "finance");
  const warehouse = roles.includes("warehouse");
  const page = warehousePage((await searchParams).page);
  const first = (page - 1) * warehousePageSize;
  const { data, error } = await db.from("staff_deliveries")
    .select("id,reference,received_on,line_count,unit_count")
    .order("received_at", { ascending: false }).order("id", { ascending: false })
    .range(first, first + warehousePageSize);
  if (error && !stockSchemaUnavailable(error)) throw new Error("Could not load delivery history.");
  const deliveries = data?.slice(0, warehousePageSize) ?? [];

  return (
    <>
      <AdminHeading title="Delivery history" eyebrow="Warehouse / Stock" description="Open a delivery to see the blades and quantities that were received." />
      {warehouse && (
        <nav className={styles.links} aria-label="Stock navigation">
          <AdminLink href="/admin/stock">Stock balances</AdminLink>
          <AdminLink href="/admin/stock/receive">Receive a delivery</AdminLink>
        </nav>
      )}
      <AdminSection title="Received deliveries">
        {error ? <AdminNotice>Delivery history is not available yet.</AdminNotice> :
          deliveries.length ? (
            <ul className={styles.ledger} role="list">
              {deliveries.map((delivery) => (
                <li className={styles.historyRow} key={delivery.id}>
                  <div>
                    <AdminLink href={`/admin/stock/deliveries/${delivery.id}`}>{delivery.reference}</AdminLink>
                    <p className="admin-muted"><time dateTime={delivery.received_on}>{dispatchDate(delivery.received_on)}</time></p>
                  </div>
                  <p className="admin-mono">{delivery.line_count} {delivery.line_count === 1 ? "line" : "lines"} · {delivery.unit_count.toLocaleString("en-GB")} units</p>
                </li>
              ))}
            </ul>
          ) : <AdminNotice>{page === 1 ? "No deliveries have been received yet." : "There are no deliveries on this page."}</AdminNotice>}
        {!error && <WarehousePagination href="/admin/stock/deliveries" page={page}
          hasMore={(data?.length ?? 0) > warehousePageSize} label="Delivery history pages" />}
      </AdminSection>
    </>
  );
}
