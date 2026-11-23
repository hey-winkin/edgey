import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/auth";
import { displayState, displayTimestamp } from "@/lib/admin/format";
import { adminPage, adminPageSize } from "@/lib/admin/pagination";
import { adminTradeAccount } from "@/lib/admin/trade";
import { isWarehouseId } from "@/lib/admin/warehouse-format";
import { formatGbp } from "@/lib/commerce";
import { AdminPagination } from "../../../pagination";
import { AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "../../../ui";
import { updateTradeCredit } from "../../credit-actions";
import { CreditLimitField, CreditReasonField } from "../../credit-fields";

type Search = Record<string, string | string[] | undefined>;

export const metadata = { title: "Trade credit account" };

export default async function TradeAccountPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  await requireStaff("finance");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isWarehouseId(id)) notFound();
  const page = adminPage(query.invoices);
  const overview = await adminTradeAccount(id, page);
  if (!overview) notFound();
  const { account, position, invoices } = overview;
  const application = account.trade_applications;
  const suspended = account.status === "suspended";

  return (
    <>
      <AdminHeading title={application?.company ?? account.buyer_name} eyebrow="Trade credit account"
        description="Review credit exposure and invoice history, or change the account’s Net 30 terms." />
      <AdminLink href="/admin/finance">Back to finance</AdminLink>
      <AdminSection title="Credit position">
        <dl className="admin-spec">
          <div><dt>Net 30 status</dt><dd>{displayState(account.status)}</dd></div>
          <div><dt>Named buyer</dt><dd>{account.buyer_name}{!account.buyer_id && " (no linked buyer)"}</dd></div>
          {application && <>
            <div><dt>Billing contact</dt><dd>{application.email}</dd></div>
            <div><dt>Application</dt><dd><AdminLink href={`/admin/requests/trade/${application.id}`}>View trade application</AdminLink></dd></div>
          </>}
          <div><dt>Credit limit</dt><dd className="admin-mono">{formatGbp(position.credit_limit_pence)}</dd></div>
          <div><dt>Held for orders</dt><dd className="admin-mono">{formatGbp(position.held_pence)}</dd></div>
          <div><dt>Outstanding invoices</dt><dd className="admin-mono">{formatGbp(position.outstanding_pence)}</dd></div>
          <div><dt>Available against limit</dt><dd className="admin-mono">{formatGbp(position.available_credit_pence)}{suspended && " (Net 30 suspended)"}</dd></div>
        </dl>
      </AdminSection>
      {account.status !== "pending" && <AdminSection title="Manage Net 30">
        <div className="admin-grid">
          <div className="admin-panel">
            <h3>Set credit limit</h3>
            <p className="admin-muted">A lower limit doesn’t change existing holds or invoice balances.</p>
            <AdminForm action={updateTradeCredit.bind(null, id, randomUUID(), "limit")} submit="Save credit limit">
              <CreditLimitField label="Credit limit (£)" value={position.credit_limit_pence} />
            </AdminForm>
          </div>
          {(!suspended || account.buyer_id) && <div className="admin-panel">
            <h3>{suspended ? "Reinstate Net 30" : "Suspend Net 30"}</h3>
            {suspended && <p className="admin-muted">Allow new Net 30 orders within the current limit. Existing balances still count.</p>}
            <AdminForm action={updateTradeCredit.bind(null, id, randomUUID(), suspended ? "reinstate" : "suspend")}
              submit={suspended ? "Reinstate Net 30" : "Suspend Net 30"}
              confirmation={suspended ? undefined : {
                description: "This blocks new Net 30 orders. Existing orders and balances aren’t changed.",
                label: "I confirm this account should not place new Net 30 orders.",
              }}>
              <CreditReasonField label="Internal reason" />
            </AdminForm>
          </div>}
        </div>
      </AdminSection>}
      <AdminSection title="Invoices">
        {invoices.length ? (
          <AdminTable label="Net 30 invoices" headers={["PO", "Order", "Status", "Issued", "Due", "Original gross", "Outstanding", "Provider"]}>
            {invoices.slice(0, adminPageSize).map((invoice) => <tr key={invoice.order_id}>
              <td className="admin-mono">{invoice.po_number}</td><td className="admin-mono">{invoice.orders?.order_reference ?? invoice.order_id}</td>
              <td>{displayState(invoice.status)}</td><td className="admin-mono">{displayTimestamp(invoice.issued_at)}</td>
              <td className="admin-mono">{displayTimestamp(invoice.due_at)}</td>
              <td className="admin-mono">{formatGbp(invoice.amount_due_pence)}</td>
              <td className="admin-mono">{formatGbp(invoice.amount_remaining_pence)}</td>
              <td><a className="textlink" href={`https://dashboard.stripe.com/test/invoices/${invoice.provider_invoice_id}`}>Stripe invoice</a></td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No invoices on this page.</AdminNotice>}
        <AdminPagination pathname={`/admin/finance/accounts/${id}`} query={query} page={page} length={invoices.length} parameter="invoices" />
      </AdminSection>
    </>
  );
}
