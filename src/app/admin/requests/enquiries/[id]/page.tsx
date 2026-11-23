import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection } from "@/app/admin/ui";
import { displayState, displayTimestamp } from "@/lib/admin/format";
import { requestsDb } from "@/lib/admin/request-schema";
import { enquiryStatus, publishedRequestVariants, requireRequestsStaff, requestBrand, requestVariantLabels, variantLabel } from "@/lib/admin/requests";
import { isWarehouseId } from "@/lib/admin/warehouse-format";
import { handleEnquiry } from "../../actions";
import { RequestTextarea } from "../../request-textarea";
import { VariantSelect } from "../../variant-select";

export const metadata = { title: "Enquiry" };

export default async function EnquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, roles } = await requireRequestsStaff();
  if (!isWarehouseId(id)) notFound();
  const { data: enquiry, error } = await requestsDb(db).from("enquiries")
    .select("id,kind,email,query,postcode,machine_brand,message,status,matched_variant_id,created_at,updated_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the enquiry.");
  if (!enquiry) notFound();
  const closed = enquiry.status === "resolved";
  const matching = !closed && enquiry.status !== "converted" && enquiry.kind === "compatibility";
  const [replies, options, labels] = await Promise.all([
    requestsDb().from("order_outbox").select("id,created_at,state,message_body")
      .eq("enquiry_id", id).like("message_key", "enquiry_reply:%")
      .order("created_at", { ascending: false }).order("id").limit(20),
    matching ? publishedRequestVariants() : [],
    requestVariantLabels(enquiry.matched_variant_id ? [enquiry.matched_variant_id] : []),
  ]);
  if (replies.error) throw new Error("Could not load the recorded replies.");
  const selected = enquiry.matched_variant_id;
  const actionTarget = { id, version: enquiry.updated_at };

  return <>
    <AdminHeading title={`${displayState(enquiry.kind)} enquiry`} eyebrow="Requests" description={enquiryStatus(enquiry.status)} />
    <AdminLink href="/admin/requests">Requests inbox</AdminLink>
    <AdminSection title="Submitted details">
      <dl className="admin-spec">
        <div><dt>Reply email</dt><dd className="admin-mono">{enquiry.email}</dd></div>
        {enquiry.kind === "compatibility" && <>
          <div><dt>Carried query</dt><dd className="admin-mono">{enquiry.query ?? "Not supplied"}</dd></div>
          <div><dt>Machine brand</dt><dd>{enquiry.machine_brand ? requestBrand(enquiry.machine_brand) : "Not supplied"}</dd></div>
        </>}
        {enquiry.postcode && <div><dt>Delivery postcode</dt><dd className="admin-mono">{enquiry.postcode}</dd></div>}
        <div><dt>Message</dt><dd className="admin-preserve-lines">{enquiry.message}</dd></div>
        <div><dt>Received</dt><dd className="admin-mono">{displayTimestamp(enquiry.created_at)}</dd></div>
        {selected && <div><dt>Matched variant</dt><dd>
          {roles.includes("catalogue") ? <AdminLink href={`/admin/catalogue/${selected}`}>{variantLabel(labels.get(selected))}</AdminLink>
            : variantLabel(labels.get(selected))}
        </dd></div>}
      </dl>
    </AdminSection>
    {!closed && <div className="admin-grid">
      <AdminSection title="Reply by email">
        <AdminForm key={enquiry.updated_at} action={handleEnquiry.bind(null, { ...actionTarget, kind: "reply", key: randomUUID() })} submit="Queue reply">
          <p>The reply is recorded here and queued to send to the submitted reply address.</p>
          <AdminField label="Reply"><RequestTextarea name="reply" rows={5} /></AdminField>
        </AdminForm>
      </AdminSection>
      {matching && <AdminSection title="Match to a variant">
        {options.length ? <AdminForm action={handleEnquiry.bind(null, { ...actionTarget, kind: "match" })} submit="Record match">
          <p>Optionally record a part code as a private candidate for catalogue review. This never adds a public alias or sends a reply.</p>
          <VariantSelect label="Matched variant" name="variantId" variants={options} />
          <AdminField label="Private candidate code (optional)"><input name="candidate" maxLength={80} /></AdminField>
        </AdminForm> : <AdminNotice>No variants are published.</AdminNotice>}
      </AdminSection>}
    </div>}
    <AdminSection title="Recorded replies">
      {replies.data.length ? <div className="grid gap-3">
        {replies.data.map((reply) => <article className="admin-panel" key={reply.id}>
          <p className="admin-muted admin-mono"><time dateTime={reply.created_at}>{displayTimestamp(reply.created_at)}</time> · {reply.state === "pending" ? "Queued" : displayState(reply.state)}</p>
          <p className="admin-preserve-lines mt-2">{reply.message_body}</p>
        </article>)}
      </div> : <AdminNotice>No replies have been recorded.</AdminNotice>}
    </AdminSection>
    {!closed && <AdminSection title="Close enquiry">
      <AdminForm action={handleEnquiry.bind(null, { ...actionTarget, kind: "close" })} submit="Close enquiry"
        confirmation={{
          description: "Staff can no longer reply or record a match once this enquiry is closed. Closing does not send an email.",
          label: "I confirm no further action is needed on this enquiry.",
        }} />
    </AdminSection>}
  </>;
}
