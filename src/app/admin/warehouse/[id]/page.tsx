import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { StaffDeliveryFields } from "@/app/admin/staff-delivery-fields";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { readStaffDeliveryChoices } from "@/lib/admin/carrier-settings";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { getWarehouseOrder, getWarehouseReturns } from "@/lib/admin/warehouse";
import { runWarehouseAction } from "@/lib/admin/warehouse-actions";
import { isWarehouseId, movementTime, warehouseLabel } from "@/lib/admin/warehouse-format";
import { returnCategories } from "@/lib/commercial/returns";
import { PickDetails } from "./pick-details";

export default async function WarehouseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await requireStaff("warehouse");
  const { id } = await params;
  if (!isWarehouseId(id)) notFound();
  const [result, trial] = await Promise.all([
    getWarehouseOrder(db, id),
    db.from("trial_fulfilments").select("trial_request_id").eq("subsequent_order_id", id).maybeSingle(),
  ]);
  if (!result) notFound();
  if (trial.error) throw new Error("Could not load the linked trial.");

  const { order, items } = result;
  const status = order.fulfilment_status;
  const undispatched = status === "ready_to_pick" || status === "picking";
  const blocked = order.payment_status === "voided" || order.payment_status === "refunded";
  const returns = status === "dispatched" ? await getWarehouseReturns(db, order.id) : [];
  const deliveryChoices = status === "picking" && !blocked ? await readStaffDeliveryChoices(db) : [];
  const returnedByVariant = new Map<string, number>();
  for (const entry of returns) {
    returnedByVariant.set(entry.variant_id, (returnedByVariant.get(entry.variant_id) ?? 0) + entry.quantity);
  }
  const returnableLines = items.map((item) => ({
    ...item, remaining: item.quantity - (returnedByVariant.get(item.variant_id) ?? 0),
  })).filter((item) => item.remaining > 0);

  return (
    <>
      <AdminHeading title="Warehouse order" eyebrow="Warehouse" />
      <nav className="flex flex-wrap gap-4" aria-label="Order navigation">
        <AdminLink href="/admin/warehouse">{staffDestinationLabels.newSalesOrders}</AdminLink>
        {undispatched && blocked && <AdminLink href="/admin/warehouse?view=blocked">Payment blocks</AdminLink>}
        <AdminLink href="/admin/warehouse?view=history">{staffDestinationLabels.pastSalesOrders}</AdminLink>
        {undispatched && !blocked && <AdminLink href={`/admin/warehouse/${order.id}/print`}>Printable pick list</AdminLink>}
      </nav>
      <AdminSection title="Order status">
        <dl className="admin-spec">
          <dt>Order reference</dt><dd className="admin-mono break-all">{order.order_reference}</dd>
          <dt>Fulfilment</dt><dd>{warehouseLabel(status)}</dd>
          <dt>Payment</dt><dd>{warehouseLabel(order.payment_status)}</dd>
          {trial.data && <><dt>Linked trial</dt><dd><AdminLink href={`/admin/requests/trials/${trial.data.trial_request_id}`}>View trial request</AdminLink></dd></>}
          {order.dispatched_at && (
            <>
              <dt>Dispatched</dt><dd><time dateTime={order.dispatched_at}>{movementTime(order.dispatched_at)}</time></dd>
              <dt>Carrier</dt><dd>{order.carrier}</dd>
              <dt>Tracking number</dt><dd className="admin-mono break-all">{order.tracking_number}</dd>
            </>
          )}
        </dl>
        {undispatched && blocked && <AdminNotice>Payment is voided or fully refunded. Do not dispatch. Confirm the parcel is still in the warehouse before releasing its allocation.</AdminNotice>}
        {status === "cancelled" && <AdminNotice>{blocked
          ? "Fulfilment cancelled and the allocation released. The recorded payment outcome is unchanged."
          : "Cancellation releases the allocation. Finance handles any refund separately."}</AdminNotice>}
      </AdminSection>
      <PickDetails order={order} items={items} />
      {status === "ready_to_pick" && !blocked && (
        <AdminSection title="Picking">
          <AdminForm action={runWarehouseAction.bind(null, { kind: "pick", orderId: order.id, key: randomUUID() })} submit="Start picking">
            <p>Mark the order as picking when you start pulling these units.</p>
          </AdminForm>
        </AdminSection>
      )}
      {status === "picking" && !blocked && (
        <AdminSection title="Dispatch">
          <AdminForm action={runWarehouseAction.bind(null, { kind: "dispatch", orderId: order.id, key: randomUUID() })} submit="Record dispatch" preserveOnError>
            <p className="break-words">Service on this order: {order.delivery_service}</p>
            <p>Check the carrier against the parcel label. If it isn’t listed, select Other and enter the carrier.</p>
            <StaffDeliveryFields choices={deliveryChoices} service={order.delivery_service} dispatch />
            <div className="admin-narrow">
              <AdminField label="Tracking number"><input name="trackingNumber" maxLength={200} required /></AdminField>
            </div>
          </AdminForm>
        </AdminSection>
      )}
      {undispatched && (
        <AdminSection title={blocked ? "Release blocked allocation" : "Cancel before dispatch"}>
          <AdminForm action={runWarehouseAction.bind(null, { kind: "cancel", orderId: order.id, key: randomUUID() })}
            submit={blocked ? "Cancel and release allocation" : "Cancel order"}
            confirmation={{
              description: blocked ? "Cancelling fulfilment releases the reserved units. It does not change the recorded payment outcome."
                : "Cancellation releases the allocation. It does not issue a refund.",
              label: blocked ? "I confirm the order has not left the warehouse."
                : "I confirm this order should be cancelled and its allocation released.",
              name: "confirmCancel",
            }} />
        </AdminSection>
      )}
      {status === "dispatched" && (
        <>
          <AdminSection title="Record a return">
            {returnableLines.length ? (
              <AdminForm action={runWarehouseAction.bind(null, { kind: "return", orderId: order.id, key: randomUUID() })} submit="Record return">
                <p>Record the units received. Inspect them before restoring any to saleable stock. For a wrong-fit return, enter the reported blade code if you know it. Do not enter personal details in the code field.</p>
                <div className="admin-grid">
                  <AdminField label="Dispatched line">
                    <select name="variantId" defaultValue="" required>
                      <option value="" disabled>Select a dispatched line</option>
                      {returnableLines.map((item) => (
                        <option key={item.variant_id} value={item.variant_id}>
                          {item.sku} · {item.option_label} · {item.remaining} returnable
                        </option>
                      ))}
                    </select>
                  </AdminField>
                  <AdminField label="Returned quantity">
                    <input name="quantity" type="number" min={1} max={2_147_483_647} step={1} required />
                  </AdminField>
                  <AdminField label="Return category">
                    <select name="returnCategory" defaultValue="" required>
                      <option value="" disabled>Select a category</option>
                      {Object.entries(returnCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </AdminField>
                  <AdminField label="Return reason"><input name="reason" maxLength={500} required /></AdminField>
                  <AdminField label="Reported blade lookup code (optional, wrong fit only)">
                    <input name="reportedLookupCode" maxLength={40} autoComplete="off" />
                  </AdminField>
                </div>
              </AdminForm>
            ) : <AdminNotice>All dispatched units have been recorded as returned.</AdminNotice>}
          </AdminSection>
          <AdminSection title="Received returns">
            {returns.length ? returns.map((entry) => {
              const item = items.find(({ variant_id }) => variant_id === entry.variant_id);
              const remaining = entry.quantity - entry.restored_quantity;
              return (
                <article key={entry.id} className="admin-panel" aria-label={`Return ${entry.id}`}>
                  <dl className="admin-spec">
                    <dt>Variant</dt><dd className="admin-mono">{item?.sku ?? entry.variant_id}</dd>
                    <dt>Received</dt><dd><time dateTime={entry.created_at}>{movementTime(entry.created_at)}</time></dd>
                    <dt>Category</dt><dd>{entry.reason_category ? returnCategories[entry.reason_category] : "Uncategorised (legacy)"}</dd>
                    <dt>Reason</dt><dd>{entry.reason}</dd>
                    {entry.reported_lookup_code && <>
                      <dt>Reported lookup code</dt><dd className="admin-mono">{entry.reported_lookup_code}</dd>
                    </>}
                    {(entry.lookup_code || entry.reason_category === "wrong_fit") && <>
                      <dt>{entry.reason_category ? "Finder lookup code" : "Legacy lookup code"}</dt>
                      <dd className="admin-mono">{entry.lookup_code ?? "No attributable code"}</dd>
                    </>}
                    <dt>Returned units</dt><dd className="admin-mono">{entry.quantity}</dd>
                    <dt>Restored units</dt><dd className="admin-mono">{entry.restored_quantity}</dd>
                  </dl>
                  {remaining ? (
                    <AdminForm action={runWarehouseAction.bind(null, {
                      kind: "restore", orderId: order.id, returnId: entry.id, key: randomUUID(),
                    })} submit="Restore inspected units">
                      <AdminField label="Saleable quantity to restore">
                        <input name="quantity" type="number" min={1} max={remaining} step={1} required />
                      </AdminField>
                    </AdminForm>
                  ) : <p>All units from this return have been restored.</p>}
                </article>
              );
            }) : <AdminNotice>No returns have been recorded for this order.</AdminNotice>}
          </AdminSection>
        </>
      )}
    </>
  );
}
