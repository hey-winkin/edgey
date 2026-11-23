import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminHeading, AdminLink, AdminNotice, AdminSection } from "@/app/admin/ui";
import { WarehousePagination } from "@/app/admin/warehouse/pagination";
import { requireStaff } from "@/lib/admin/auth";
import { getAddablePurchaseVariant } from "@/lib/admin/purchase-order-data";
import { purchaseStatusLabel } from "@/lib/admin/purchase-orders";
import { canManageCosts, stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { dispatchDate, isWarehouseId, warehousePage, warehousePageSize } from "@/lib/admin/warehouse-format";
import styles from "./purchase-orders.module.css";

const pathname = "/admin/purchase-orders";

export default async function PurchaseOrders({ searchParams }: { searchParams: Promise<{ page?: string; variant?: string }> }) {
  const { db, roles } = await requireStaff("warehouse", "catalogue", "finance");
  const { page: pageInput, variant: variantId } = await searchParams;
  const showCosts = canManageCosts(roles);
  if (variantId && (!showCosts || !isWarehouseId(variantId))) notFound();
  const page = warehousePage(pageInput);
  const first = (page - 1) * warehousePageSize;
  const ordersQuery = db.from("staff_purchase_orders")
    .select("id,number,status,ordered_on,expected_on")
    .order("updated_at", { ascending: false }).order("id", { ascending: false });
  if (variantId) ordersQuery.eq("status", "draft");
  else if (!showCosts) ordersQuery.neq("status", "draft");
  const [orders, blade] = await Promise.all([
    ordersQuery.range(first, first + warehousePageSize),
    variantId ? getAddablePurchaseVariant(variantId) : null,
  ]);
  if (variantId && !blade) notFound();
  if (orders.error && !stockSchemaUnavailable(orders.error)) throw new Error("Could not load purchase orders.");
  const rows = orders.data?.slice(0, warehousePageSize) ?? [];
  const variantQuery = variantId ? `?variant=${variantId}` : "";

  return (
    <>
      <AdminHeading title={blade ? "Add to purchase order" : "Purchase orders"}
        description={blade ? "Choose a draft purchase order or start a new one for this blade."
          : "Raise orders against the catalogue and track what’s still due to arrive."} />
      {blade && <p className={styles.selection}><strong>{blade.products?.name}</strong> <span className="admin-mono">{blade.sku}</span>
        {blade.option_label && <span>{blade.option_label}</span>}</p>}
      <nav className={styles.links} aria-label="Purchase order navigation">
        {showCosts && !orders.error && <Link className="primary" href={`${pathname}/new${variantQuery}`}>Start a draft PO</Link>}
        {blade ? <AdminLink href="/admin/catalogue">Back to catalogue</AdminLink>
          : <>
              {roles.includes("warehouse") && <AdminLink href="/admin/stock">Stock balances</AdminLink>}
              {showCosts && !orders.error && <>
                <AdminLink href={`${pathname}/suppliers`}>Suppliers</AdminLink>
                <AdminLink href={`${pathname}/settings`}>Buyer settings</AdminLink>
              </>}
            </>}
      </nav>
      <AdminSection title={blade ? "Draft purchase orders" : "Orders"}>
        {orders.error ? <AdminNotice>Purchase orders are not available yet.</AdminNotice> :
          rows.length ? (
            <ul className={styles.ledger} role="list">
              {rows.map((order) => (
                <li className={styles.indexRow} key={order.id}>
                  <div>
                    <AdminLink href={blade ? `${pathname}/${order.id}/edit${variantQuery}` : `${pathname}/${order.id}`}>
                      {blade ? `Add to ${order.number}` : order.number}
                    </AdminLink>
                    <p className="admin-muted">Ordered <time dateTime={order.ordered_on}>{dispatchDate(order.ordered_on)}</time></p>
                  </div>
                  <p>{purchaseStatusLabel[order.status]}</p>
                  <p className="admin-muted">{order.expected_on
                    ? <>Expected <time dateTime={order.expected_on}>{dispatchDate(order.expected_on)}</time></>
                    : "No expected date"}</p>
                </li>
              ))}
            </ul>
          ) : <AdminNotice>{blade ? "There are no draft orders to add this blade to." : "There are no purchase orders on this page."}</AdminNotice>}
        {!orders.error && <WarehousePagination href={`${pathname}${variantQuery}`} page={page}
          hasMore={(orders.data?.length ?? 0) > warehousePageSize} label="Purchase order pages" />}
      </AdminSection>
    </>
  );
}
