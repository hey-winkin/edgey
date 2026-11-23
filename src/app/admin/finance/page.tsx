import { formatGbp } from "@/lib/commerce";
import { requireStaff } from "@/lib/admin/auth";
import { financeOverview } from "@/lib/admin/finance";
import { displayState, displayTimestamp } from "@/lib/admin/format";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { adminPage, adminPageSize } from "@/lib/admin/pagination";
import { amountMismatch } from "@/lib/admin/payment-review";
import { lateCapture } from "@/lib/payments/card-refund";
import { AdminPagination } from "../pagination";
import { AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "../ui";
import { reconcileFinanceInvoice, refundFinanceCard, resolveFinancePaymentReview, retryFinanceFailure } from "./actions";

type Search = Record<string, string | string[] | undefined>;

export const metadata = { title: staffDestinationLabels.financeAndTradeAccounts };

function CardRefundForm({ id, intentId, verifyOnly = false }: { id: string; intentId: string | null; verifyOnly?: boolean }) {
  return <AdminForm action={refundFinanceCard.bind(null, id, !verifyOnly)}
    submit={verifyOnly ? "Verify recorded refund" : "Verify or refund remaining capture"}
    confirmation={verifyOnly ? undefined : {
      description: "If Stripe shows an unrefunded balance, this issues a refund for the full remaining capture.",
      label: "I confirm the remaining capture can be refunded.",
      submit: "Verify payment and refund if due",
    }}>
    {intentId && <a className="textlink" href={`https://dashboard.stripe.com/test/payments/${encodeURIComponent(intentId)}`}>Stripe payment</a>}
  </AdminForm>;
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const { db } = await requireStaff("finance");
  const query = await searchParams;
  const pages = {
    orders: adminPage(query.orders), captures: adminPage(query.captures), reviews: adminPage(query.reviews),
    events: adminPage(query.events), outbox: adminPage(query.outbox),
    accounts: adminPage(query.accounts), overdue: adminPage(query.overdue), voids: adminPage(query.voids),
    adjustments: adminPage(query.adjustments),
  };
  const overview = await financeOverview(db, pages);
  const requested = new Map(overview.queued.map(({ kind, target_id, target_updated_at, result }) =>
    [`${kind}:${target_id}:${target_updated_at}`, result]));
  const replayLabel = (key: string) => {
    const result = requested.get(key);
    if (result === undefined) return null;
    if (result === null) return "Retry queued.";
    if (result === "not_replayable") return "A safe retry isn’t available.";
    return `Retry outcome: ${displayState(result)}`;
  };
  const nav = (key: keyof typeof pages) => (
    <AdminPagination pathname="/admin/finance" query={query} parameter={key}
      page={pages[key]} length={overview[key].length} />
  );

  return (
    <>
      <AdminHeading title={staffDestinationLabels.financeAndTradeAccounts}
        description="Manage Net 30 accounts, follow up overdue invoices and review payment exceptions." />
      <AdminLink href="/admin/requests">Review trade applications</AdminLink>
      <AdminSection title="Trade accounts">
        {overview.accounts.length ? (
          <AdminTable label="Trade accounts" headers={["Business", "Named buyer", "Net 30 status", "Credit limit"]}>
            {overview.accounts.slice(0, adminPageSize).map((account) => <tr key={account.id}>
              <td><AdminLink href={`/admin/finance/accounts/${account.id}`}>{account.trade_applications?.company ?? account.buyer_name}</AdminLink></td>
              <td>{account.buyer_name}</td><td>{displayState(account.status)}</td>
              <td className="admin-mono admin-money">{formatGbp(account.credit_limit_pence)}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No trade accounts on this page.</AdminNotice>}
        {nav("accounts")}
      </AdminSection>
      <AdminSection title="Overdue follow-up">
        {overview.overdue.length ? (
          <AdminTable label="Overdue invoices" headers={["Account", "Billing contact", "PO", "Due", "Outstanding"]}>
            {overview.overdue.slice(0, adminPageSize).map((invoice) => {
              const contact = overview.overdueContacts.get(invoice.trade_account_id);
              return <tr key={invoice.order_id}>
                <td><AdminLink href={`/admin/finance/accounts/${invoice.trade_account_id}`}>{contact?.company ?? "View account"}</AdminLink></td>
                <td className="admin-mono">{contact?.email ?? "—"}</td>
                <td className="admin-mono">{invoice.po_number}</td>
                <td className="admin-mono">{displayTimestamp(invoice.due_at)}</td>
                <td className="admin-mono">{formatGbp(invoice.amount_remaining_pence)}</td>
              </tr>;
            })}
          </AdminTable>
        ) : <AdminNotice>No overdue invoices on this page.</AdminNotice>}
        {nav("overdue")}
      </AdminSection>
      <AdminSection title="Cancelled Net 30 invoices">
        {overview.voids.length ? (
          <>
            <p className="admin-muted">Void only if your finance policy permits it and Stripe confirms the invoice is unpaid. Otherwise, use the Stripe invoice to credit any unpaid balance and refund any payment. If a credit note includes a refund, link it to the existing refund or issue it there once. Then verify the adjustment here. Edgey keeps any outstanding credit until Stripe confirms the change.</p>
            <AdminTable label="Cancelled Net 30 orders" headers={["Order", "Business", "PO", "Outstanding balance", "Unrefunded payment", "Action"]}>
              {overview.voids.slice(0, adminPageSize).map((order) => <tr key={order.id}>
                <td className="admin-mono">{order.order_reference}</td>
                <td>{order.trade_account_id ? <AdminLink href={`/admin/finance/accounts/${order.trade_account_id}`}>{order.business_name}</AdminLink> : order.business_name}</td>
                <td className="admin-mono">{order.po_number}</td>
                <td className="admin-mono">{order.invoices[0] ? formatGbp(order.invoices[0].amount_remaining_pence) : "—"}</td>
                <td className="admin-mono">{formatGbp(order.paid_pence - order.refunded_pence)}</td>
                <td>
                  {order.provider_invoice_id && <a className="textlink" href={`https://dashboard.stripe.com/test/invoices/${encodeURIComponent(order.provider_invoice_id)}`}>Stripe invoice</a>}
                  {!order.paid_pence && <AdminForm action={reconcileFinanceInvoice.bind(null, order.id, true)} submit="Verify and void invoice"
                    confirmation={{
                      description: "This closes the invoice in Stripe if it is unpaid. The buyer can no longer pay a voided invoice.",
                      label: "I confirm our finance policy permits voiding this invoice.",
                      submit: "Verify and void if unpaid",
                    }} />}
                  <AdminForm action={reconcileFinanceInvoice.bind(null, order.id, false)} submit="Verify Stripe adjustments" />
                </td>
              </tr>)}
            </AdminTable>
          </>
        ) : <AdminNotice>No cancelled Net 30 invoices awaiting resolution on this page.</AdminNotice>}
        {nav("voids")}
      </AdminSection>
      <AdminSection title="Payment review">
        {overview.reviews.some((order) => order.payment_method === "card" && order.payment_review_reason === amountMismatch) &&
          <p className="admin-muted">Refund a mismatched payment in Stripe first. Edgey closes the review only after verifying the full refund.</p>}
        {overview.reviews.length ? (
          <AdminTable label="Payment review" headers={["Order", "Business", "Payment", "Reason", "Action"]}>
            {overview.reviews.slice(0, adminPageSize).map((order) => <tr key={order.id}>
              <td className="admin-mono">{order.order_reference}</td><td>{order.business_name}</td>
              <td>{displayState(order.payment_status)}</td>
              <td>{order.stripe_reconciliation_error ?? (order.payment_review_reason && displayState(order.payment_review_reason))}</td>
              <td>{order.payment_method === "card" && order.payment_review_reason === amountMismatch
                ? <AdminForm action={resolveFinancePaymentReview.bind(null, order.id)} submit="Verify full refund">
                    {order.payment_intent_id && <a className="textlink" href={`https://dashboard.stripe.com/test/payments/${encodeURIComponent(order.payment_intent_id)}`}>Stripe payment</a>}
                  </AdminForm> : order.payment_method === "card" && order.payment_review_reason === lateCapture
                    ? <CardRefundForm id={order.id} intentId={order.payment_intent_id}
                        verifyOnly={order.refunded_pence === order.paid_pence} /> : "—"}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No orders to review on this page.</AdminNotice>}
        {nav("reviews")}
      </AdminSection>
      <AdminSection title="Cancelled orders with outstanding capture">
        <p className="admin-muted">Warehouse cancels picking and releases stock. Finance can then verify an existing refund or refund the rest of the capture.</p>
        {overview.captures.length ? (
          <AdminTable label="Outstanding captures" headers={["Order", "Business", "Payment", "Unrefunded capture", "Action"]}>
            {overview.captures.slice(0, adminPageSize).map((order) => <tr key={order.id}>
              <td className="admin-mono">{order.order_reference}</td><td>{order.business_name}</td>
              <td>{displayState(order.payment_status)}</td>
              <td className="admin-mono">{formatGbp(order.paid_pence - order.refunded_pence)}</td>
              <td><CardRefundForm id={order.id} intentId={order.payment_intent_id} /></td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No outstanding captures on this page.</AdminNotice>}
        {nav("captures")}
      </AdminSection>
      <AdminSection title="Post-dispatch adjustments">
        <p className="admin-muted">These refunds, credits and voids were reconciled after dispatch. They don’t restore stock. A cash refund does not reopen the invoice balance.</p>
        {overview.adjustments.length ? (
          <AdminTable label="Post-dispatch adjustments" headers={["Order", "Method", "Adjustment", "Amount", "Outstanding balance change", "Provider reference", "Reconciled"]}>
            {overview.adjustments.slice(0, adminPageSize).map((item) => (
              <tr key={`${item.order_id}:${item.kind}:${item.provider_reference}`}>
                <td className="admin-mono">{item.order_reference}</td>
                <td>{item.payment_method === "net30" ? "Net 30" : "Card"}</td>
                <td>{item.kind && displayState(item.kind)}</td>
                <td className="admin-mono">{item.amount_pence === null ? "—" : formatGbp(item.amount_pence)}</td>
                <td className="admin-mono">{item.outstanding_delta_pence === null ? "—" : formatGbp(item.outstanding_delta_pence)}</td>
                <td className="admin-mono">{item.provider_reference}</td>
                <td className="admin-mono">{item.reconciled_at && displayTimestamp(item.reconciled_at)}</td>
              </tr>
            ))}
          </AdminTable>
        ) : <AdminNotice>No post-dispatch adjustments on this page.</AdminNotice>}
        {nav("adjustments")}
      </AdminSection>
      <AdminSection title="Failed provider events">
        {overview.events.length ? (
          <AdminTable label="Failed provider events" headers={["Event", "Type", "Last error", "Retry"]}>
            {overview.events.slice(0, adminPageSize).map((event) => <tr key={`${event.provider}:${event.event_id}`}>
              <td className="admin-mono">{event.event_id}</td><td>{event.event_type}</td><td>{event.last_error}</td>
              <td>{event.provider !== "stripe" ? "No replay available" : replayLabel(`event:${event.event_id}:${event.updated_at}`) ?? (
                <AdminForm action={retryFinanceFailure.bind(null, { kind: "event", id: event.event_id })} submit="Reprocess event" />
              )}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No failed provider events on this page.</AdminNotice>}
        {nav("events")}
      </AdminSection>
      <AdminSection title="Confirmation outbox">
        {overview.outbox.length ? (
          <AdminTable label="Confirmation outbox" headers={["Order", "Status", "Last error", "Updated", "Retry"]}>
            {overview.outbox.slice(0, adminPageSize).map((message) => <tr key={message.order_id}>
              <td className="admin-mono">
                {message.orders?.order_reference && <span className="block">{message.orders.order_reference}</span>}
                {message.order_id}
              </td><td>{displayState(message.state)}</td>
              <td>{message.last_error ? displayState(message.last_error) : "—"}</td>
              <td className="admin-mono">{displayTimestamp(message.updated_at)}</td><td>{message.state !== "failed" || !message.order_id ? "—" :
              replayLabel(`confirmation:${message.order_id}:${message.updated_at}`) ?? (
                <AdminForm action={retryFinanceFailure.bind(null, { kind: "confirmation", id: message.order_id })} submit="Resend confirmation" />
              )}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No pending or failed confirmations on this page.</AdminNotice>}
        {nav("outbox")}
      </AdminSection>
      <AdminSection title="Orders">
        {overview.orders.length ? (
          <AdminTable label="Orders and payment status" headers={["Order", "Business", "Method", "Payment", "Fulfilment", "Total", "Created"]}>
            {overview.orders.slice(0, adminPageSize).map((order) => <tr key={order.id}>
              <td className="admin-mono">{order.order_reference}</td><td>{order.business_name}</td>
              <td>{order.payment_method === "net30" ? "Net 30" : "Card"}</td>
              <td>{displayState(order.payment_status)}</td><td>{displayState(order.fulfilment_status)}</td>
              <td className="admin-mono">{formatGbp(order.gross_pence)}</td>
              <td className="admin-mono">{displayTimestamp(order.created_at)}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No orders on this page.</AdminNotice>}
        {nav("orders")}
      </AdminSection>
    </>
  );
}
