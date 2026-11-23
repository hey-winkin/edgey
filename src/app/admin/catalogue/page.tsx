import { requireStaff } from "@/lib/admin/auth";
import { catalogueCodeMaxLength, catalogueStatuses, listAdminCatalogue } from "@/lib/admin/catalogue";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { adminPageSize } from "@/lib/admin/pagination";
import { getPurchaseStock } from "@/lib/admin/purchase-order-data";
import { purchaseRoles } from "@/lib/admin/roles";
import { readRunningLow, runningLowView } from "@/lib/admin/running-low";
import { decodeStockSelection, stockSelectionLimit } from "@/lib/admin/stock-selection";
import { displayState } from "@/lib/admin/format";
import { formatPence } from "@/lib/catalogue/display-prices";
import { AdminField, AdminHeading, AdminLink, AdminNotice, AdminTable } from "@/app/admin/ui";
import { OnOrder } from "@/app/admin/purchase-orders/on-order";
import { getActiveStockSelection, submitStockSelection } from "./stock-selection-action";
import { StockSelectionForm } from "./stock-selection-form";
import "./list.css";

export const metadata = { title: staffDestinationLabels.stock };

const pathname = "/admin/catalogue";

export default async function CataloguePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff(...purchaseRoles);
  const canEdit = staff.roles.includes("catalogue");
  const canAdjustStock = staff.roles.includes("warehouse");
  const query = await searchParams;
  const runningLow = query.view === runningLowView;
  const lowIds = runningLow ? await readRunningLow(staff.db) : undefined;
  const [{ brands, filters, page, length, rows }, selected] = await Promise.all([
    listAdminCatalogue(staff, query, runningLow ? lowIds ?? [] : undefined),
    query.selected === undefined && lowIds && lowIds.length <= stockSelectionLimit
      ? lowIds : getActiveStockSelection(decodeStockSelection(query.selected)),
  ]);
  const onOrder = await getPurchaseStock(staff.db, rows.map(({ id }) => id));
  const hasFilters = Boolean(filters.q || filters.status || filters.brand);
  const selectedIds = new Set(selected);
  const pageIds = onOrder ? rows.filter(({ status }) => status !== "archived").map(({ id }) => id) : [];
  const pageIdSet = new Set(pageIds);
  const offPageIds = onOrder ? selected.filter((id) => !pageIdSet.has(id)) : [];
  const notice = query.selectionNotice === "limit" ? `Selection limited to ${stockSelectionLimit} blades. Review the selection before ordering.` :
    query.selectionNotice === "matching-limit" ? `The matching blades would exceed the ${stockSelectionLimit}-blade limit. Narrow the filters or clear part of your selection.` :
    query.selectionNotice === "removed" ? "Some selected blades are no longer available to order. Review the remaining selection." :
      query.selectionNotice === "empty" ? "Select at least one blade to order stock." : undefined;
  async function updateSelection(form: FormData) {
    "use server";

    await submitStockSelection({ filters, page, pageIds, offPageIds, runningLow }, form);
  }

  return (
    <div className="catalogue-list">
      <div className="catalogue-list-heading">
        <AdminHeading title={staffDestinationLabels.stock} description={runningLow
          ? "Running low: less than two weeks’ cover at the last 30 days’ sales rate, including units already on order."
          : "Check availability and order blades."} />
        <div className="catalogue-list-links">
          {runningLow && <AdminLink href={pathname}>All stock</AdminLink>}
          {canAdjustStock && <AdminLink href="/admin/stock">{staffDestinationLabels.adjustStock}</AdminLink>}
          {canEdit && <AdminLink href={`${pathname}/new`}>Add draft variant</AdminLink>}
        </div>
      </div>
      {runningLow && lowIds === null && <AdminNotice>Could not calculate stock cover. Try again or return to All stock.</AdminNotice>}
      {lowIds && lowIds.length > stockSelectionLimit && query.selected === undefined &&
        <AdminNotice>More than {stockSelectionLimit} blades are running low. Select blades in batches for each order.</AdminNotice>}
      <StockSelectionForm action={updateSelection} key={JSON.stringify([filters, page, selected, pageIds])}
        offPageCount={offPageIds.length} initialVisibleCount={onOrder ? selected.length - offPageIds.length : 0} pageSize={pageIds.length}
        hasFilters={hasFilters} canSelectMatching={Boolean(onOrder && filters.status !== "archived" && (page > 1 || length > adminPageSize))}
        notice={notice && <p className="admin-notice" role="status">{notice}</p>}
        filters={(
          <>
            <AdminField label="Search by code">
              <input type="search" name="q" defaultValue={filters.q} maxLength={catalogueCodeMaxLength}
                placeholder="Edgey SKU or OEM code" />
            </AdminField>
            <AdminField label="Status">
              <select name="status" defaultValue={filters.status ?? ""}>
                <option value="">All statuses</option>
                {catalogueStatuses.map((status) => <option key={status} value={status}>{displayState(status)}</option>)}
              </select>
            </AdminField>
            <AdminField label="Brand">
              <select name="brand" defaultValue={filters.brand ?? ""}>
                <option value="">All brands</option>
                {brands.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
              </select>
            </AdminField>
          </>
        )}
      >
        {rows.length === 0 ? <AdminNotice>{page > 1
          ? "No catalogue variants on this page."
          : hasFilters ? "No catalogue variants match these filters."
            : runningLow ? "No blades in this view." : "No catalogue variants yet."}</AdminNotice> : (
          <AdminTable label="Stock variants" headers={[...(pageIds.length ? ["Select"] : []), "Blade variant", "Status", "Stock", "Price from"]}>
            {rows.map((variant) => (
              <tr key={variant.id}>
                {pageIds.length > 0 && <td className="catalogue-list-checkbox">
                  {variant.status !== "archived" && (
                    <label className="catalogue-list-check">
                      <input type="checkbox" name="variant" value={variant.id} defaultChecked={selectedIds.has(variant.id)} />
                      <span className="sr">Select {variant.sku}</span>
                    </label>
                  )}
                </td>}
                <th scope="row">
                  <span className="admin-mono"><AdminLink href={`${pathname}/${variant.id}`}>{variant.sku}</AdminLink></span>
                  <span className="catalogue-list-name">{variant.name}</span>
                  {variant.option && <span className="catalogue-list-detail admin-muted">{variant.option}</span>}
                </th>
                <td>
                  <span className="catalogue-list-status" data-status={variant.status}>{displayState(variant.status)}</span>
                  <span className="catalogue-list-detail admin-muted">{variant.review}</span>
                </td>
                <td className="catalogue-list-stock">
                  <dl>
                    <div><dt>Available</dt><dd className="admin-mono">{variant.available}</dd></div>
                    <div><dt>On order</dt><dd><OnOrder summary={onOrder} variantId={variant.id} /></dd></div>
                  </dl>
                </td>
                <td>
                  <span className="admin-mono">{variant.priceFromPence === null ? "Not set" : formatPence(variant.priceFromPence)}</span>
                  {variant.costStatus !== "recorded" && (
                    <span className="catalogue-list-detail admin-muted" data-cost-status={variant.costStatus}>
                      {variant.costStatus === "missing" ? "Cost missing" : "Cost status unavailable"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </AdminTable>
        )}
        {(page > 1 || length > adminPageSize) && (
          <nav aria-label="Stock pages" className="admin-pagination">
            {page > 1 && <button type="submit" name="intent" value="previous" className="catalogue-list-text-button">Previous page</button>}
            <span className="admin-mono">Page {page}</span>
            {length > adminPageSize && <button type="submit" name="intent" value="next" className="catalogue-list-text-button">Next page</button>}
          </nav>
        )}
      </StockSelectionForm>
    </div>
  );
}
