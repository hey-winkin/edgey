import { AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { stockOutOfStockHref } from "@/lib/admin/navigation";
import { getPurchaseStock } from "@/lib/admin/purchase-order-data";
import { getStockList } from "@/lib/admin/warehouse";
import { warehouseLabel, warehousePage } from "@/lib/admin/warehouse-format";
import { WarehousePagination } from "../warehouse/pagination";
import { OnOrder } from "../purchase-orders/on-order";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ page?: string; view?: string }> }) {
  const { db } = await requireStaff("warehouse");
  const { page: requestedPage, view } = await searchParams;
  const page = warehousePage(requestedPage);
  const outOfStock = view === "out-of-stock";
  const { rows, hasMore } = await getStockList(page, outOfStock);
  const onOrder = await getPurchaseStock(db, rows.map(({ id }) => id));

  return (
    <>
      <AdminHeading
        title={outOfStock ? "Out of stock" : "Stock"}
        eyebrow="Warehouse"
        description={outOfStock ? "Published blade variants with no units available." :
          "Receive a whole delivery, or choose a SKU to receive individual blades, record an adjustment or review its movements."}
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {outOfStock && <AdminLink href="/admin/stock">Show all stock</AdminLink>}
        <AdminLink href="/admin/stock/receive">Receive a delivery</AdminLink>
        <AdminLink href="/admin/purchase-orders">Purchase orders</AdminLink>
        <AdminLink href="/admin/stock/deliveries">Delivery history</AdminLink>
        <AdminLink href="/admin/warehouse">Picking queue</AdminLink>
      </div>
      <AdminSection title="Variant balances">
        <p className="admin-muted mb-3">Available stock excludes units held for orders and trials.</p>
        {rows.length ? (
          <AdminTable label="Variant balances" headers={["SKU", "Variant", "Catalogue status", "On hand", "Reserved", "Available", "On order"]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="admin-mono"><AdminLink href={`/admin/stock/${row.id}`}>{row.sku}</AdminLink></td>
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
