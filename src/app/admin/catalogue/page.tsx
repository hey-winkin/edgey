import { requireStaff } from "@/lib/admin/auth";
import { catalogueCodeMaxLength, catalogueStatuses, listAdminCatalogue } from "@/lib/admin/catalogue";
import { displayState } from "@/lib/admin/format";
import { formatPence } from "@/lib/catalogue/display-prices";
import { AdminPagination } from "@/app/admin/pagination";
import { AdminField, AdminHeading, AdminLink, AdminNotice, AdminTable } from "@/app/admin/ui";
import "./list.css";

const pathname = "/admin/catalogue";

export default async function CataloguePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff("catalogue", "finance");
  const canEdit = staff.roles.includes("catalogue");
  const { brands, filters, page, length, rows } = await listAdminCatalogue(staff, await searchParams);
  const hasFilters = Boolean(filters.q || filters.status || filters.brand);

  return (
    <div className="catalogue-list">
      <div className="catalogue-list-heading">
        <AdminHeading title="Catalogue" description={canEdit
          ? "Manage blade variants, prices, costs and publication."
          : "Review blade prices and manage supplier cost estimates."} />
        {canEdit && <AdminLink href={`${pathname}/new`}>Add draft variant</AdminLink>}
      </div>
      <form className="catalogue-list-filters" role="search" aria-label="Catalogue filters" action={pathname}
        key={JSON.stringify(filters)}>
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
        <button type="submit" className="primary">Apply filters</button>
      </form>
      <div className="catalogue-list-summary">
        <p className="admin-muted">Available stock excludes reservations. Prices are per blade, ex VAT.</p>
        {hasFilters && <AdminLink href={pathname}>Clear filters</AdminLink>}
      </div>
      {rows.length === 0 ? <AdminNotice>{page > 1
        ? "No catalogue variants on this page."
        : hasFilters ? "No catalogue variants match these filters." : "No catalogue variants yet."}</AdminNotice> : (
        <AdminTable label="Catalogue variants" headers={["Blade variant", "Status", "Available", "Price from"]}>
          {rows.map((variant) => (
            <tr key={variant.id}>
              <th scope="row">
                <span className="admin-mono"><AdminLink href={`${pathname}/${variant.id}`}>{variant.sku}</AdminLink></span>
                <span className="catalogue-list-name">{variant.name}</span>
                {variant.option && <span className="catalogue-list-detail admin-muted">{variant.option}</span>}
              </th>
              <td>
                <span className="catalogue-list-status" data-status={variant.status}>{displayState(variant.status)}</span>
                <span className="catalogue-list-detail admin-muted">{variant.review}</span>
              </td>
              <td className="admin-mono">{variant.available}</td>
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
      <AdminPagination pathname={pathname} query={filters} parameter="page" page={page} length={length} />
    </div>
  );
}
