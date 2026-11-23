import { AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels as labels, stockOutOfStockHref } from "@/lib/admin/navigation";
import { getPurchaseStock } from "@/lib/admin/purchase-order-data";
import { hasPurchasingRole } from "@/lib/admin/roles";
import { getStockList } from "@/lib/admin/warehouse";
import { warehouseLabel, warehousePage } from "@/lib/admin/warehouse-format";
import { WarehousePagination } from "../warehouse/pagination";
import { OnOrder } from "../purchase-orders/on-order";
import { OrderStockLink } from "../purchase-orders/order-stock-link";

type StockProps = { searchParams: Promise<{ page?: string; view?: string }> };
const outOfStockTitle = "Out of stock";

export async function generateMetadata({ searchParams }: StockProps) {
  return { title: (await searchParams).view === "out-of-stock" ? outOfStockTitle : labels.adjustStock };
}

export default async function StockPage({ searchParams }: StockProps) {
  const { db, roles } = await requireStaff("warehouse");
  const { page: requestedPage, view } = await searchParams;
  const page = warehousePage(requestedPage);
  const outOfStock = view === "out-of-stock";
  const { rows, hasMore } = await getStockList(page, outOfStock);
  const onOrder = await getPurchaseStock(db, rows.map(({ id }) => id));
  const showOrderStock = outOfStock && hasPurchasingRole(roles);

  return (
    <>
      <AdminHeading
        title={outOfStock ? outOfStockTitle : labels.adjustStock}
        eyebrow="Warehouse"
        description={outOfStock ? "Published blade variants with no units available." :
          "Check what’s available and what’s on order. Choose a blade to adjust stock or see its movements."}
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {showOrderStock && <OrderStockLink />}
        {outOfStock && <AdminLink href="/admin/stock">{labels.adjustStock}</AdminLink>}
        {hasPurchasingRole(roles) && <AdminLink href="/admin/catalogue">{labels.stock}</AdminLink>}
        <AdminLink href="/admin/stock/receive">{labels.bookInDelivery}</AdminLink>
        <AdminLink href="/admin/purchase-orders">{labels.purchaseOrders}</AdminLink>
        <AdminLink href="/admin/stock/deliveries">{labels.deliveryHistory}</AdminLink>
        <AdminLink href="/admin/warehouse">{labels.newSalesOrders}</AdminLink>
      </div>
      <AdminSection title="Variant balances">
        <p className="admin-muted mb-3">Available stock excludes units held for orders and trials.</p>
        {rows.length ? (
          <AdminTable label="Variant balances" headers={["SKU", "Variant", "Catalogue status", "On hand", "Reserved", "Available", "On order"]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="admin-mono"><AdminLink href={`/admin/stock/${row.id}`}>{row.sku}</AdminLink></span>
                  {showOrderStock && <div className="mt-2"><OrderStockLink variant={{ id: row.id, sku: row.sku }} /></div>}
                </td>
                <td>{row.option_label || row.tool || "Standard variant"}</td>
                <td>{warehouseLabel(row.publication_status)}</td>
                <td className="admin-mono">{row.stock_on_hand}</td>
                <td className="admin-mono">{row.stock_reserved}</td>
                <td className="admin-mono">{row.stock_on_hand - row.stock_reserved}</td>
                <td><OnOrder summary={onOrder} variantId={row.id} /></td>
              </tr>
            ))}
          </AdminTable>
        ) : <AdminNotice>No variants found on this page.</AdminNotice>}
        <WarehousePagination href={outOfStock ? stockOutOfStockHref : "/admin/stock"} page={page} hasMore={hasMore} label="Stock pages" />
      </AdminSection>
    </>
  );
}
