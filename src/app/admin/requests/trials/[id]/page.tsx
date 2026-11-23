import { notFound } from "next/navigation";
import { StaffDeliveryFields } from "@/app/admin/staff-delivery-fields";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "@/app/admin/ui";
import { readStaffDeliveryChoices } from "@/lib/admin/carrier-settings";
import { displayTimestamp } from "@/lib/admin/format";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { requestsDb } from "@/lib/admin/request-schema";
import { publishedRequestVariants, requireRequestsStaff, requestBrand, requestVariantLabels, trialStatus, variantLabel } from "@/lib/admin/requests";
import { isWarehouseId, warehouseOrderLookup } from "@/lib/admin/warehouse-format";
import { deliveryCoverageForPostcode } from "@/lib/delivery/server";
import { handleTrial } from "../../actions";
import { AddressInput } from "../../address-input";
import { RequestTextarea } from "../../request-textarea";
import { VariantSelect } from "../../variant-select";
import { TrialMailStatus } from "./trial-mail-status";

export const metadata = { title: "Trial request" };

export default async function TrialPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ order?: string | string[] }>;
}) {
  const { id } = await params;
  const { db, roles, userId } = await requireRequestsStaff();
  if (!isWarehouseId(id)) notFound();
  const requestDb = requestsDb(db);
  const warehouse = roles.includes("warehouse");
  const catalogue = roles.includes("catalogue");
  const { data: trial, error } = await requestDb.from("trial_requests")
    .select("id,machine_brand,oem_code,email,company,postcode,status,staff_notes,created_at,updated_at,eligibility,reviewed_variant_ids,reviewed_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the trial request.");
  if (!trial) notFound();

  const reviewable = trial.status === "pending" || trial.status === "in_review";
  const reviewedIds = trial.reviewed_variant_ids ?? [];
  const canApprove = warehouse && reviewable && trial.eligibility === "eligible" && reviewedIds.length === 2;
  const [{ data: duplicateRows, error: duplicateError }, { data: allocations, error: allocationError }, delivery, options, coverage, deliveryChoices] =
    await Promise.all([
      requestDb.rpc("admin_trial_duplicate_evidence", { p_trial_request_id: id }),
      db.from("trial_allocations").select("variant_id,quantity").eq("trial_request_id", id).order("variant_id"),
      warehouse ? db.from("trial_fulfilments")
        .select("state,recipient_name,address_line1,address_line2,address_town,address_region,address_postcode,address_country,address_verified_at,carrier,carrier_service,dispatched_at,tracking_number,cancelled_at,subsequent_order_id")
        .eq("trial_request_id", id).maybeSingle() : null,
      catalogue && reviewable ? publishedRequestVariants() : [],
      deliveryCoverageForPostcode(trial.postcode),
      canApprove ? readStaffDeliveryChoices(db) : [],
    ]);
  if (duplicateError || allocationError || delivery?.error) throw new Error("Could not load the trial checks.");
  const fulfilment = delivery?.data;
  const labels = await requestVariantLabels([...new Set([...reviewedIds, ...allocations.map((row) => row.variant_id)])]);
  const linking = Boolean(fulfilment?.state === "dispatched" && fulfilment.dispatched_at && !fulfilment.subsequent_order_id);
  const candidates = linking ? await requestsDb().rpc("admin_trial_order_candidates", { p_trial_request_id: id, p_actor_id: userId }) : null;
  if (candidates?.error) throw new Error("Could not load matching order references.");
  const orderIds = fulfilment?.subsequent_order_id ? [fulfilment.subsequent_order_id] : candidates?.data.map(({ id }) => id) ?? [];
  const orders = orderIds.length ? await db.from("orders").select("id,order_reference").in("id", orderIds) : null;
  if (orders?.error) throw new Error("Could not load order references.");
  const references = new Map(orders?.data.map(({ id, order_reference }) => [id, order_reference]));
  const { order: selectedOrder } = await searchParams;
  const orderToLink = typeof selectedOrder === "string" ? warehouseOrderLookup(selectedOrder)?.value ?? "" : "";
  const path = `/admin/requests/trials/${id}`;

  return <>
    <AdminHeading title="Trial request" eyebrow="Requests" description={trialStatus(trial.status, fulfilment?.state)} />
    <AdminLink href="/admin/requests">{staffDestinationLabels.customerEnquiries}</AdminLink>
    <TrialMailStatus db={db} id={id} />
    <div className="admin-grid">
      <AdminSection title="Submitted details">
        <dl className="admin-spec">
          <div><dt>Machine brand</dt><dd>{requestBrand(trial.machine_brand)}</dd></div>
          <div><dt>OEM code</dt><dd className="admin-mono">{trial.oem_code}</dd></div>
          <div><dt>Work email</dt><dd className="admin-mono">{trial.email}</dd></div>
          <div><dt>Company</dt><dd>{trial.company}</dd></div>
          <div><dt>Submitted postcode</dt><dd className="admin-mono">{trial.postcode}</dd></div>
          <div><dt>Received</dt><dd className="admin-mono">{displayTimestamp(trial.created_at)}</dd></div>
        </dl>
      </AdminSection>
      <AdminSection title="Eligibility and coverage">
        <dl className="admin-spec">
          <div><dt>Eligibility</dt><dd>{trial.eligibility === "eligible" ? "Eligible" : trial.status === "declined" ? "Declined" : "Not decided"}</dd></div>
          {trial.staff_notes && <div><dt>Decision reason</dt><dd className="admin-preserve-lines">{trial.staff_notes}</dd></div>}
          {trial.reviewed_at && <div><dt>Reviewed</dt><dd className="admin-mono">{displayTimestamp(trial.reviewed_at)}</dd></div>}
          <div><dt>Submitted postcode</dt><dd>{!coverage.ok ? "Coverage could not be checked." : coverage.value.kind === "covered"
            ? `Within configured coverage · ${coverage.value.quote.serviceName}`
            : "Outside configured coverage. An agreed service is needed."}</dd></div>
        </dl>
        <p className="admin-muted mt-3">Warehouse must verify the full address and carrier service before approving.</p>
      </AdminSection>
    </div>
    <AdminSection title="Earlier requests">
      {duplicateRows.length ? <>
        <p className="admin-muted mb-3">Showing up to 20 earlier matches. Use them as evidence when reviewing eligibility; a match does not automatically decline the trial.</p>
        <AdminTable label="Possible duplicate trial requests" headers={["Company", "Shared details", "Received"]}>
          {duplicateRows.map((row) => <tr key={row.id}>
            <td><AdminLink href={`/admin/requests/trials/${row.id}`}>{row.company}</AdminLink></td>
            <td>{[row.same_email && "Email", row.same_company && "Company", row.same_postcode && "Postcode"].filter(Boolean).join(" · ")}</td>
            <td className="admin-mono">{displayTimestamp(row.created_at)}</td>
          </tr>)}
        </AdminTable>
      </> : <AdminNotice>No earlier requests share the submitted email, company or postcode.</AdminNotice>}
    </AdminSection>
    {(allocations.length > 0 || reviewedIds.length > 0) && <AdminSection title={allocations.length ? "Trial units" : "Reviewed units"}>
      <AdminTable label="Trial blade units" headers={["Variant", "Quantity"]}>
        {allocations.length ? allocations.map(({ variant_id, quantity }) =>
          <tr key={variant_id}><td>{variantLabel(labels.get(variant_id))}</td><td className="admin-mono">{quantity}</td></tr>
        ) : [...new Set(reviewedIds)].map((variantId) =>
          <tr key={variantId}><td>{variantLabel(labels.get(variantId))}</td><td className="admin-mono">{reviewedIds.filter((item) => item === variantId).length}</td></tr>
        )}
      </AdminTable>
    </AdminSection>}
    {catalogue && reviewable && <div className="admin-grid">
      <AdminSection title="Confirm fit and eligibility">
        {options.some((variant) => variant.availability === "in_stock") ?
          <AdminForm action={handleTrial.bind(null, { kind: "eligible", id, version: trial.updated_at })} submit={trial.eligibility === "eligible" ? "Update eligible decision" : "Record eligible decision"}>
            <p>Choose two published blade units that fit. Choose the same variant twice for two of the same blade. This review does not reserve stock.</p>
            <VariantSelect label="First blade unit" name="unit1" variants={options} selected={reviewedIds[0]} stock />
            <VariantSelect label="Second blade unit" name="unit2" variants={options} selected={reviewedIds[1]} stock />
            <AdminField label="Eligibility reason"><RequestTextarea name="reason" rows={3} initial={trial.eligibility === "eligible" ? trial.staff_notes ?? "" : ""} /></AdminField>
          </AdminForm> : <AdminNotice>No published variants currently have available stock.</AdminNotice>}
      </AdminSection>
      <AdminSection title="Decline">
        <AdminForm action={handleTrial.bind(null, { kind: "declined", id, version: trial.updated_at })} submit="Decline trial"
          confirmation={{
            description: "This ends the trial request and queues a notice to the customer. The reason stays with staff.",
            label: "I confirm this trial request should be declined.",
          }}>
          <AdminField label="Decline reason"><RequestTextarea name="reason" rows={3} /></AdminField>
        </AdminForm>
      </AdminSection>
    </div>}
    {warehouse && reviewable && <AdminSection title="Verify delivery and approve">
      {canApprove ?
        <AdminForm action={handleTrial.bind(null, { kind: "approve", id, variantIds: reviewedIds })} submit="Approve and reserve two units" preserveOnError>
          <p>Record the complete UK address. Approval reserves both reviewed units and queues the approval notice.</p>
          <div className="admin-grid">
            <AddressInput label="Recipient name" name="recipient" maxLength={200} required />
            <AddressInput label="Address line 1" name="line1" maxLength={200} required />
            <AddressInput label="Address line 2 (optional)" name="line2" maxLength={200} />
            <AddressInput label="Town or city" name="town" maxLength={100} required />
            <AddressInput label="County (optional)" name="region" maxLength={100} />
            <AddressInput label="Delivery postcode" name="postcode" maxLength={32} initial={trial.postcode} required />
          </div>
          <p>Select a configured service or choose Other to enter the carrier and service. Enter the carrier if the selected service has none configured.</p>
          <StaffDeliveryFields choices={deliveryChoices} service={coverage.ok && coverage.value.kind === "covered" ? coverage.value.quote.serviceName : null} />
          <p className="admin-muted">Country: United Kingdom. The delivery postcode is checked again on approval.</p>
          <label className="admin-check"><input type="checkbox" name="verified" value="yes" required /> I verified that this carrier service can deliver to the full address.</label>
        </AdminForm> : <AdminNotice>Catalogue staff must record an eligible decision and select two units before warehouse can approve.</AdminNotice>}
    </AdminSection>}
    {fulfilment && <AdminSection title="Delivery record">
      <dl className="admin-spec">
        <div><dt>Recipient</dt><dd>{fulfilment.recipient_name}</dd></div>
        <div><dt>Delivery address</dt><dd>{[
          fulfilment.address_line1, fulfilment.address_line2, fulfilment.address_town,
          fulfilment.address_region, fulfilment.address_postcode, "United Kingdom",
        ].filter(Boolean).join(", ")}</dd></div>
        <div><dt>Verified</dt><dd className="admin-mono">{displayTimestamp(fulfilment.address_verified_at)}</dd></div>
        <div><dt>Carrier and service</dt><dd>{fulfilment.carrier} · {fulfilment.carrier_service}</dd></div>
        {fulfilment.tracking_number && <div><dt>Tracking number</dt><dd className="admin-mono">{fulfilment.tracking_number}</dd></div>}
        {fulfilment.dispatched_at && <div><dt>Dispatched</dt><dd className="admin-mono">{displayTimestamp(fulfilment.dispatched_at)}</dd></div>}
        {fulfilment.cancelled_at && <div><dt>Cancelled</dt><dd className="admin-mono">{displayTimestamp(fulfilment.cancelled_at)}</dd></div>}
      </dl>
    </AdminSection>}
    {fulfilment?.state === "allocated" && <div className="admin-grid">
      <AdminSection title="Dispatch">
        <AdminForm action={handleTrial.bind(null, { kind: "dispatch", id })} submit="Record dispatch">
          <p>Dispatch the two reserved units with {fulfilment.carrier} · {fulfilment.carrier_service} to the verified address above.</p>
          <AdminField label="Tracking number"><input name="tracking" maxLength={200} required /></AdminField>
        </AdminForm>
      </AdminSection>
      <AdminSection title="Cancel before dispatch">
        <AdminForm action={handleTrial.bind(null, { kind: "cancel", id })} submit="Cancel trial"
          confirmation={{
            description: "This cancels the trial and releases both units back into available stock.",
            label: "I confirm this trial should be cancelled and its units released.",
          }} />
      </AdminSection>
    </div>}
    {fulfilment?.subsequent_order_id && <AdminSection title="Linked order">
      <AdminLink href={`/admin/warehouse/${fulfilment.subsequent_order_id}`}>{references.get(fulfilment.subsequent_order_id) ?? "View linked order"}</AdminLink>
      <div className="admin-narrow">
        <AdminForm action={handleTrial.bind(null, { kind: "unlink", id, orderId: fulfilment.subsequent_order_id })} submit="Remove order link"
          confirmation={{
            description: "Removing this link updates the trial purchase count. It does not change the order or the trial dispatch.",
            label: "I confirm this trial and order should no longer be linked.",
          }} />
      </div>
    </AdminSection>}
    {linking && <AdminSection title="Link a subsequent order">
      <p className="admin-muted mb-3">Confirm the buyer and that the order followed this trial. A matching email is only a lead, even on an order placed by a signed-in buyer.</p>
      {candidates?.data.length ? <AdminTable label="Possible subsequent orders" headers={["Order", "Matching evidence", "Placed", "Link"]}>
        {candidates.data.filter(({ id }) => references.has(id)).map((order) => <tr key={order.id}>
          <td><AdminLink href={`/admin/warehouse/${order.id}`}>{references.get(order.id)}</AdminLink></td>
          <td>{order.match_kind === "verified_account_email" ? "Verified account email" : "Order contact email"}</td><td>{displayTimestamp(order.created_at)}</td>
          <td><AdminLink href={`${path}?order=${references.get(order.id)}#link-order`}>Use this order</AdminLink></td>
        </tr>)}
      </AdminTable> : <p className="admin-muted mb-3">No later authorised orders match the submitted email. If you’ve confirmed another order, enter its reference below.</p>}
      <div className="mt-3 admin-narrow" id="link-order" key={orderToLink}>
        <AdminForm action={handleTrial.bind(null, { kind: "link", id })} submit="Link order">
          <AdminField label="Order reference"><input name="orderId" defaultValue={orderToLink} maxLength={36} required /></AdminField>
          <label className="admin-check"><input type="checkbox" name="confirm" value="yes" required /> I confirmed this order followed the trial.</label>
        </AdminForm>
      </div>
    </AdminSection>}
  </>;
}
