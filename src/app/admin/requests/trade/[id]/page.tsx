import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/auth";
import { displayState, displayTimestamp } from "@/lib/admin/format";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { adminTradeApplication } from "@/lib/admin/trade";
import { isWarehouseId } from "@/lib/admin/warehouse-format";
import { decideTradeApplication } from "../../../finance/credit-actions";
import { CreditLimitField, CreditReasonField } from "../../../finance/credit-fields";
import { AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection } from "../../../ui";

export const metadata = { title: "Trade application" };

export default async function TradeApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff("finance");
  const { id } = await params;
  if (!isWarehouseId(id)) notFound();
  const result = await adminTradeApplication(id);
  if (!result) notFound();
  const { application, accountId } = result;
  const approvalPending = application.status === "pending" && application.approval_started_at;
  const canApprove = !!application.buyer_id && !accountId && ["pending", "approved"].includes(application.status);
  const canReject = !!application.buyer_id && !accountId && application.status === "pending" && !approvalPending;

  return (
    <>
      <AdminHeading title={application.company} eyebrow="Trade application" description="Review the named buyer and billing details before offering Net 30." />
      <AdminLink href="/admin/requests">{staffDestinationLabels.customerEnquiries}</AdminLink>
      <AdminSection title="Application details">
        <dl className="admin-spec">
          <div><dt>Status</dt><dd>{approvalPending ? "Approval in progress" : displayState(application.status)}</dd></div>
          <div><dt>Named buyer</dt><dd>{application.buyer_name}</dd></div>
          <div><dt>Email</dt><dd>{application.email}</dd></div>
          <div><dt>Billing address</dt><dd>{[application.billing_line1, application.billing_line2, application.billing_town, application.billing_postcode].filter(Boolean).join(", ")}</dd></div>
          <div><dt>Received</dt><dd className="admin-mono">{displayTimestamp(application.created_at)}</dd></div>
          {application.reviewed_at && <div><dt>Reviewed</dt><dd className="admin-mono">{displayTimestamp(application.reviewed_at)}</dd></div>}
          {application.rejection_reason && <div><dt>Internal reason</dt><dd className="admin-preserve-lines">{application.rejection_reason}</dd></div>}
        </dl>
      </AdminSection>
      {accountId && <AdminNotice>Approval recorded. <AdminLink href={`/admin/finance/accounts/${accountId}`}>View trade account</AdminLink></AdminNotice>}
      {!application.buyer_id && !accountId && <AdminNotice>No buyer is linked to this application. A verified buyer is needed to offer Net 30.</AdminNotice>}
      {approvalPending && <AdminNotice>Stripe setup already started. Retry approval to recover the same customer. This application can’t be rejected while approval is in progress.</AdminNotice>}
      {(canApprove || canReject) && <AdminSection title="Record a decision">
        <div className="admin-grid">
          {canApprove && <div className="admin-panel">
            <h3>Approve Net 30</h3>
            <p className="admin-muted">Set the initial credit limit in pounds, including VAT. Approval sets up the Stripe customer and queues a notice.</p>
            <AdminForm action={decideTradeApplication.bind(null, id, "approved")} submit={approvalPending ? "Retry approval" : "Approve trade account"}>
              <CreditLimitField label="Initial credit limit (£)" />
            </AdminForm>
          </div>}
          {canReject && <div className="admin-panel">
            <h3>Reject application</h3>
            <AdminForm action={decideTradeApplication.bind(null, id, "rejected")} submit="Reject application"
              confirmation={{
                description: "This rejects the Net 30 application and queues a notice to the buyer. The reason stays with finance.",
                label: "I confirm this buyer’s Net 30 application should be rejected.",
              }}>
              <CreditReasonField label="Internal rejection reason" />
            </AdminForm>
          </div>}
        </div>
      </AdminSection>}
    </>
  );
}
