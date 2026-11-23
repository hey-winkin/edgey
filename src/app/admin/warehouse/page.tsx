import type { Metadata } from "next";
import { AdminField, AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { countWarehousePaymentBlocks, getWarehouseQueue, type WarehouseView } from "@/lib/admin/warehouse";
import { dispatchDate, movementTime, warehouseLabel, warehouseOrderLookup, warehousePage } from "@/lib/admin/warehouse-format";
import { WarehousePagination } from "./pagination";

const views = {
  queue: {
    title: staffDestinationLabels.newSalesOrders,
    tableLabel: "Ready to pick and picking",
    empty: "There are no orders waiting to pick or dispatch.",
    href: "/admin/warehouse",
  },
  history: {
    title: staffDestinationLabels.pastSalesOrders,
    tableLabel: "Dispatch and cancellation history",
    empty: "There are no dispatched or cancelled orders.",
    href: "/admin/warehouse?view=history",
  },
  blocked: {
    title: "Payment blocks",
    tableLabel: "Payment blocks",
    empty: "There are no orders blocked by a void or full refund.",
    href: "/admin/warehouse?view=blocked",
  },
};

type Props = {
  searchParams: Promise<{ view?: string; reference?: string; page?: string }>;
};

function warehouseView(view?: string): WarehouseView {
  return view === "history" || view === "blocked" ? view : "queue";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { view } = await searchParams;
  return { title: views[warehouseView(view)].title };
}

export default async function WarehousePage({ searchParams }: Props) {
  const { db } = await requireStaff("warehouse");
  const { view: selected, reference, page: requestedPage } = await searchParams;
  const view = warehouseView(selected);
  const lookup = typeof reference === "string" ? reference.trim().slice(0, 100) : "";
  const parsedLookup = warehouseOrderLookup(lookup);
  const invalid = Boolean(lookup) && !parsedLookup;
  const page = lookup ? 1 : warehousePage(requestedPage);
  const [{ rows, hasMore }, blocked] = await Promise.all([
    invalid ? { rows: [], hasMore: false } : getWarehouseQueue(db, { view, page, lookup: parsedLookup }),
    countWarehousePaymentBlocks(db),
  ]);

  return (
    <>
      <AdminHeading
        eyebrow="Warehouse"
        title={views[view].title}
        description={view === "blocked"
          ? "Do not dispatch these orders. Open an order to release its allocation once you confirm it has not left the warehouse."
          : "Pick against the order snapshot and record carrier and tracking when the parcel leaves."}
      />
      <nav aria-label="Warehouse views" className="flex flex-wrap gap-4">
        {view !== "queue" && <AdminLink href={views.queue.href}>{views.queue.title}</AdminLink>}
        {view !== "history" && <AdminLink href={views.history.href}>{views.history.title}</AdminLink>}
        {view !== "blocked" && <AdminLink href={views.blocked.href}>{views.blocked.title}</AdminLink>}
      </nav>
      {view !== "blocked" && blocked > 0 && <AdminNotice>
        Stock action needed: <AdminLink href={views.blocked.href}>{blocked} payment-blocked {blocked === 1 ? "order" : "orders"}</AdminLink> still {blocked === 1 ? "has" : "have"} stock allocated.
      </AdminNotice>}
      {view === "blocked" && blocked > 0 && <AdminNotice>
        Do not pick or dispatch these orders. Open each order and cancel it to release the allocation. Finance handles refunds separately.
      </AdminNotice>}
      <form action="/admin/warehouse" method="get" className="admin-panel mt-3 flex flex-wrap items-end gap-3">
        {view !== "queue" && <input type="hidden" name="view" value={view} />}
        <AdminField label="Order reference">
          <input className="admin-mono" name="reference" defaultValue={lookup} maxLength={100} required />
        </AdminField>
        <button type="submit" className="admin-secondary">Find order</button>
        {lookup && <AdminLink href={views[view].href}>Clear lookup</AdminLink>}
      </form>
      <AdminSection title={lookup ? "Order lookup" : view === "queue" ? views.queue.tableLabel : "Orders"}>
        {!rows.length ? (
          <AdminNotice>{invalid ? "Enter the full order reference." : lookup
            ? "No authorised order matches that reference." : views[view].empty}</AdminNotice>
        ) : (
          <AdminTable
            label={lookup ? "Order lookup" : views[view].tableLabel}
            headers={["Order reference", "Recipient", "Service", "Promised dispatch", "Fulfilment", view === "history" && !lookup ? "Dispatched" : "Payment"]}
          >
            {rows.map((order) => (
              <tr key={order.id}>
                <td className="admin-mono break-all"><AdminLink href={`/admin/warehouse/${order.id}`}>{order.order_reference}</AdminLink></td>
                <td>{order.recipient_name}<br />{order.business_name}</td>
                <td>{order.delivery_service}</td>
                <td className="admin-mono"><time dateTime={order.promised_dispatch_date}>{dispatchDate(order.promised_dispatch_date)}</time></td>
                <td>{warehouseLabel(order.fulfilment_status)}</td>
                <td>{view === "history" && !lookup
                  ? order.dispatched_at
                    ? <time dateTime={order.dispatched_at}>{movementTime(order.dispatched_at)}</time>
                    : "Not dispatched"
                  : warehouseLabel(order.payment_status)}</td>
              </tr>
            ))}
          </AdminTable>
        )}
        <WarehousePagination href={views[view].href} page={page} hasMore={hasMore} label="Order pages" />
      </AdminSection>
    </>
  );
}
