import Link from "next/link";
import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { missingSalesMigration, readSalesReport } from "@/lib/sales/database";
import {
  decimalHundredths, displaySalesRange, parseSalesQuery, productSorts, salesMoney, salesParams, sortProducts,
  type SalesProduct, type SalesQuery, type SalesReport, type SalesSearch, type SalesSort, type SalesSplit,
} from "@/lib/sales/report";
import { AdminHeading, AdminNotice, AdminSection, AdminTable } from "../ui";
import SalesFilters from "./filters";
import RevenueChart from "./revenue-chart";
import "./sales.css";

export const metadata = { title: staffDestinationLabels.salesReports };

const number = new Intl.NumberFormat("en-GB");
const rate = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const tierNames: Record<string, string> = { "1-4": "1–4 blades", "5-9": "5–9 blades", "10+": "10+ blades" };
const paymentNames: Record<string, string> = { card: "Card", net30: "Net 30" };
const stockLabels = { low: "Low cover", never_sold: "Never sold", no_sales: "No sales in period" } as const;
const stockRank = { low: 0, never_sold: 1, no_sales: 2 } as const;
const money = (value: number | null) => value === null ? "—" : salesMoney(value);
const percent = (bps: number) => `${decimalHundredths(bps)}%`;
const cover = (value: number | null) => value === null ? "—" : rate.format(value);
const margin = (pence: number | null, bps: number | null, unknown: boolean) =>
  pence === null ? unknown ? "Cost missing" : "—" : `${money(pence)}${bps === null ? "" : ` · ${percent(bps)}`}`;

function Highlights({ report }: { report: SalesReport }) {
  const { current: c, previous: p } = report;
  const cards = [
    ["Revenue ex VAT", money(c.revenuePence), money(p.revenuePence)],
    ["Orders", number.format(c.orders), number.format(p.orders)],
    ["Units", number.format(c.units), number.format(p.units)],
    ["Average order value", money(c.aovPence), money(p.aovPence)],
    ["VAT", money(c.vatPence), money(p.vatPence)],
    ["Delivery ex VAT", money(c.deliveryPence), money(p.deliveryPence)],
    ...(report.canSeeMargin ? [["Gross margin", margin(c.marginPence, c.marginBps, c.units > 0),
      margin(p.marginPence, p.marginBps, p.units > 0)]] : []),
    ["Recorded refunds incl VAT", money(c.refundsPence), money(p.refundsPence)],
    ["Net 30 credits and voids", money(c.creditsPence), money(p.creditsPence)],
  ];
  return <dl className="sales-highlights" data-margin={report.canSeeMargin}>
    {cards.map(([label, current, previous]) => <div key={label} className="sales-metric">
      <dt>{label}</dt>
      <dd className="sales-value admin-mono">{current}</dd>
      <dd className="sales-prior">Previous: <span className="admin-mono">{previous}</span></dd>
    </div>)}
  </dl>;
}

function ProductLabel({ row }: { row: SalesProduct }) {
  return <><span className="sales-product-name">{row.name}</span><span className="admin-mono admin-muted">{row.sku}</span></>;
}

function ProductTable({ report, query }: { report: SalesReport; query: SalesQuery }) {
  const { products, canSeeMargin } = report;
  if (!products.length) return <AdminNotice>No published blades or sales in this period.</AdminNotice>;
  const active = !canSeeMargin && query.sort === "marginPence" ? "revenuePence" : query.sort;
  const direction = active === query.sort ? query.dir : "desc";
  return <div className="admin-table-scroll sales-table-scroll" role="region" aria-label="Product sales" tabIndex={0}>
    <table className="admin-table sales-table" aria-label="Product sales">
      <thead><tr>
        {(Object.entries(productSorts) as [SalesSort, string][]).filter(([key]) => canSeeMargin || key !== "marginPence")
          .map(([key, label]) => {
            const selected = key === active;
            const next = selected ? (direction === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc";
            const params = salesParams({ ...query, sort: key, dir: next });
            return <th scope="col" key={key}
              aria-sort={selected ? direction === "asc" ? "ascending" : "descending" : undefined}>
              <Link className="textlink sales-sort" href={`/admin/sales?${params}#products`} prefetch={false} scroll={false}
                aria-label={`Sort by ${label.toLowerCase()}, ${next === "asc" ? "ascending" : "descending"}`}>
                {label} <span aria-hidden="true">{selected ? direction === "asc" ? "↑" : "↓" : "↕"}</span>
              </Link>
            </th>;
          })}
      </tr></thead>
      <tbody>
        {sortProducts(products, query.sort, query.dir, canSeeMargin).map((row) => <tr key={row.id}>
          <th scope="row"><ProductLabel row={row} /></th>
          <td className="admin-mono">{number.format(row.units)}</td>
          <td className="admin-mono">{money(row.revenuePence)}</td>
          {canSeeMargin && <td className="admin-mono">{margin(row.marginPence, row.marginBps, row.costUnknown === true)}</td>}
          <td className="admin-mono">{row.shareBps === null ? "—" : percent(row.shareBps)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>;
}

function SalesBreakdown({ rows, names, count }: {
  rows: SalesSplit[]; names: Record<string, string>; count: "orders" | "units";
}) {
  const total = rows.reduce((sum, row) => sum + row.revenuePence, 0);
  return <ul className="sales-breakdown">
    {rows.map((row) => <li key={row.key}>
      <div><b>{names[row.key]}</b><span className="admin-muted">{number.format(row[count] ?? 0)} {count}</span></div>
      <span className="admin-mono">{money(row.revenuePence)}</span>
      <progress max={total || 1} value={row.revenuePence} aria-hidden="true" />
    </li>)}
  </ul>;
}

function StockTable({ products }: { products: SalesProduct[] }) {
  if (!products.length) return <AdminNotice>No blade balances to show.</AdminNotice>;
  const rows = [...products].sort((a, b) => (a.stockFlag ? stockRank[a.stockFlag] : 3) - (b.stockFlag ? stockRank[b.stockFlag] : 3)
    || (a.weeksCover ?? Infinity) - (b.weeksCover ?? Infinity) || a.sku.localeCompare(b.sku, "en-GB"));
  return <div className="sales-stock-table"><AdminTable label="Stock cover" headers={["Product", "Available units", "Units per week", "Weeks of cover", "Status"]}>
    {rows.map((row) => <tr key={row.id}>
      <th scope="row"><ProductLabel row={row} /></th>
      <td className="admin-mono">{number.format(row.available)}</td>
      <td className="admin-mono">{rate.format(row.weeklyUnits)}</td>
      <td className="admin-mono">{cover(row.weeksCover)}</td>
      <td>{row.stockFlag ? <span className={row.stockFlag === "no_sales" ? "admin-muted" : "sales-stock-flag"}>
        {stockLabels[row.stockFlag]}
      </span> : "—"}</td>
    </tr>)}
  </AdminTable></div>;
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<SalesSearch> }) {
  const { db } = await requireStaff("warehouse", "catalogue", "finance");
  const query = parseSalesQuery(await searchParams);
  const result = query.range ? await readSalesReport(db, query.range, query.grain) : null;
  if (result?.error && !missingSalesMigration(result.error.code)) throw new Error("Could not load sales reporting.");
  const report = result?.data;
  const exportLink = (kind: "products" | "daily") => {
    const params = salesParams({ ...query, period: "custom", draft: query.range! });
    params.set("kind", kind);
    return `/admin/sales/export?${params}`;
  };

  return <>
    <AdminHeading title={staffDestinationLabels.salesReports} description="See what sold, how it compares and how long your stock may last." />
    <SalesFilters key={salesParams(query).toString()} query={query} />
    {result && !report && <AdminNotice>Sales reporting isn’t available yet. Try again after the database update.</AdminNotice>}
    {report && query.range && <>
      <AdminSection title="Sales summary">
        <p className="sales-context admin-muted">
          <strong>{displaySalesRange(query.range)}</strong> compared with {displaySalesRange(query.previous)} · UK time
        </p>
        <Highlights report={report} />
      </AdminSection>
      <AdminSection title="Revenue over time">
        <p className="sales-section-intro admin-muted">Booked blade sales before VAT, delivery and refunds.</p>
        <RevenueChart rows={report.series} grain={query.grain} />
        <a className="textlink sales-action" href={exportLink("daily")}>Download daily sales CSV</a>
      </AdminSection>
      <div id="products">
        <AdminSection title="Product sales">
          <p className="sales-section-intro admin-muted">One row per blade SKU. Select a column to change the order.
            <span className="sales-scroll-hint"> Scroll across for more columns.</span>
          </p>
          <ProductTable report={report} query={query} />
          <a className="textlink sales-action" href={exportLink("products")}>Download product sales CSV</a>
        </AdminSection>
      </div>
      <div className="sales-splits">
        <AdminSection title="Price tiers">
          <p className="sales-section-intro admin-muted">Units and revenue by line quantity.</p>
          <SalesBreakdown rows={report.tiers} names={tierNames} count="units" />
        </AdminSection>
        <AdminSection title="Payment methods">
          <p className="sales-section-intro admin-muted">Orders and booked revenue by method.</p>
          <SalesBreakdown rows={report.payments} names={paymentNames} count="orders" />
        </AdminSection>
        <AdminSection title="Buyers">
          <p className="sales-section-intro admin-muted">Each buyer is counted once in this period.</p>
          <dl className="admin-spec">
            <dt>New</dt><dd className="admin-mono">{number.format(report.buyers.new)}</dd>
            <dt>Returning</dt><dd className="admin-mono">{number.format(report.buyers.returning)}</dd>
          </dl>
        </AdminSection>
      </div>
      <AdminSection title="Stock cover">
        <p className="sales-section-intro admin-muted">
          For published blades, compare stock available now with sales in the chosen period. Low cover means less than two weeks at that rate.
          <span className="sales-scroll-hint"> Scroll across for more columns.</span>
        </p>
        <StockTable products={report.products.filter((product) => product.published)} />
      </AdminSection>
      <details className="admin-panel sales-details sales-definitions">
        <summary>How these figures are worked out</summary>
        <dl className="admin-spec">
          <dt>What counts as a sale</dt>
          <dd>Card orders count on payment confirmation and Net 30 orders on authorisation, even if the invoice has not been paid.
            Orders ready to pick, being picked or dispatched count. Orders cancelled before dispatch, unpaid card attempts and
            free trial packs do not.</dd>
          <dt>Revenue and tax</dt>
          <dd>Revenue is the booked value of blades, excluding VAT and delivery. The VAT includes tax on delivery.
            Average order value is blade revenue divided by orders. The comparison uses the preceding period with the same
            number of UK calendar days.</dd>
          <dt>Refunds, credits and returns</dt>
          <dd>Recorded cash refunds include VAT and are dated when reconciled, including refunds for cancelled orders.
            Net 30 credits and voids show reductions in the invoice balance separately. After dispatch, they do not remove the
            original sale or automatically return stock. These amounts are not deducted from booked revenue, VAT, units or margin.
            Refunds without a recorded amount aren’t included. Use Finance for reconciliation.</dd>
          {report.canSeeMargin && <>
            <dt>Gross margin</dt>
            <dd>Blade revenue less landed unit costs, as pounds and a share of blade revenue. It uses the latest costed receipt
              on or before the sale, including any correction, otherwise the current variant estimate. If any sold line has
              no cost, its product margin and the overall margin are unknown. This is a margin estimate, not inventory valuation.</dd>
          </>}
          <dt>Buyers and stock</dt>
          <dd>We match signed-in buyers by account and guest buyers by email, not across the two. Buyers with a qualifying
            order before the chosen period are returning. Available stock excludes reserved units. Weekly sales use booked units divided by
            the length of the selected period in weeks; weeks of cover divides available stock by that rate.
            “Never sold” means no qualifying sale on record for a published blade.</dd>
        </dl>
      </details>
    </>}
  </>;
}
