import Link from "next/link";
import { accountDate, fulfilmentLabels, orderPaymentLabel, tradeInvoiceLabels } from "@/lib/account/display";
import { listBuyerOrders } from "@/lib/account/server";
import { getBuyerTradePosition, listBuyerTradeInvoices } from "@/lib/account/trade";
import { sendAccountSignInLink, signOutOfAccount } from "@/lib/auth/actions";
import { getOwnTradeApplicationStatus, getVerifiedBuyer } from "@/lib/auth/server";
import { formatGbp } from "@/lib/commerce";
import { RequestForm } from "@/components/requests/request-form";
import { requestAvailability, requestsUnavailable } from "@/lib/requests/availability";
import styles from "./account.module.css";

const applicationStatus = {
  pending: { title: "Application pending", detail: "We’ll email you after we’ve reviewed it." },
  approved: { title: "Application approved", detail: "Net 30 isn’t available yet." },
  rejected: { title: "Application not approved", detail: "If you have questions about the decision, contact us." },
};

function pageNumber(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,6}$/.test(value) ? Number(value) : 1;
}

function accountPage(orders: number, invoices: number) {
  const query = new URLSearchParams();
  if (orders > 1) query.set("page", String(orders));
  if (invoices > 1) query.set("invoicePage", String(invoices));
  return query.size ? `/account?${query}` : "/account";
}

export default async function AccountPage({ searchParams }: {
  searchParams: Promise<{ signin?: string; signout?: string; page?: string; invoicePage?: string }>;
}) {
  const [buyer, params] = await Promise.all([getVerifiedBuyer(), searchParams]);
  if (!buyer) {
    const availability = requestAvailability();
    return (
      <main id="main-content" tabIndex={-1} className="frame simple-page">
        <p className="kicker"><span className="register" aria-hidden="true" /> Buyer account</p>
        <h1>Sign in to your account</h1>
        <p className={`muted ${styles.signInIntro}`}>Use an email link to see orders linked to your account. Guest orders don’t appear here, even if they used the same email address.</p>
        {params.signin === "retry" && (
          <p className={styles.panel} role="status">We couldn’t verify the sign-in link. Request a new link and open it in this browser.</p>
        )}
        {availability.enabled ? (
          <RequestForm
            action={sendAccountSignInLink}
            fields={[{ name: "email", label: "Email address", type: "email", autoComplete: "email", required: true }]}
            submitLabel="Send sign-in link"
            successTitle="Check your email"
            successMessage="Open the sign-in link in this browser to continue."
            keepFormOnSuccess
          />
        ) : <p className={styles.panel} role="status">{requestsUnavailable}</p>}
        {"privacyUrl" in availability && (
          <p className={styles.privacy}><a className="textlink" href={availability.privacyUrl}>Privacy notice</a></p>
        )}
      </main>
    );
  }

  const page = pageNumber(params.page);
  const invoicePage = pageNumber(params.invoicePage);
  const [orderResult, applicationResult, tradeResult, invoiceResult] = await Promise.allSettled([
    listBuyerOrders(page), getOwnTradeApplicationStatus(), getBuyerTradePosition(), listBuyerTradeInvoices(invoicePage),
  ]);
  const history = orderResult.status === "fulfilled" ? orderResult.value : null;
  const status = applicationResult.status === "fulfilled" ? applicationResult.value : null;
  const trade = tradeResult.status === "fulfilled" ? tradeResult.value : null;
  const invoices = invoiceResult.status === "fulfilled" ? invoiceResult.value : null;

  return (
    <main id="main-content" tabIndex={-1} className={`frame ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <p className="kicker"><span className="register" aria-hidden="true" /> Buyer account</p>
          <h1>Your account</h1>
          <p className="muted">Order history, dispatch and trade applications.</p>
        </div>
        <form action={signOutOfAccount} className={styles.session}>
          <p className="muted">Signed in as {buyer.email}</p>
          <button className="textlink" type="submit">Sign out</button>
          {params.signout === "retry" && <p role="alert">We couldn’t sign you out. Please try again.</p>}
        </form>
      </header>

      <div className={styles.columns}>
        <section aria-labelledby="orders-title">
          <h2 id="orders-title">Orders</h2>
          {orderResult.status === "rejected" ? (
            <p className={styles.panel}>We couldn’t load your orders. <Link className="textlink" href="/account">Try again</Link></p>
          ) : history?.orders.length ? (
            <ol className={styles.orderList} role="list">
              {history.orders.map((order) => (
                <li key={order.id} className={styles.orderRow}>
                  <div className={styles.orderHeader}>
                    <div>
                      <p className="eyebrow">Order reference</p>
                      <Link href={`/account/orders/${order.id}`} prefetch={false} className={`textlink ${styles.reference}`} aria-label={`View order ${order.order_reference}`}>{order.order_reference}</Link>
                    </div>
                    <time dateTime={order.created_at} className={styles.figure}>{accountDate(order.created_at)}</time>
                  </div>
                  <dl className={styles.facts}>
                    <div><dt>Payment</dt><dd>{orderPaymentLabel(order.payment_status, order.fulfilment_status)}</dd></div>
                    <div><dt>Fulfilment</dt><dd>{fulfilmentLabels[order.fulfilment_status]}</dd></div>
                    <div className={styles.orderTotal}><dt>Total inc VAT</dt><dd className={styles.figure}>{formatGbp(order.gross_pence)}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.panel}>
              <p>{page === 1 ? "You don’t have any orders on this account yet." : "There are no orders on this page."}</p>
              {page === 1 && <Link className="textlink" href="/blades">Browse blades</Link>}
            </div>
          )}
          {(page > 1 || history?.hasOlder) && (
            <nav aria-label="Order pages" className={styles.actions}>
              {page > 1 && <Link className="textlink" href={accountPage(page - 1, invoicePage)}>Newer orders</Link>}
              {history?.hasOlder && <Link className="textlink" href={accountPage(page + 1, invoicePage)}>Older orders</Link>}
            </nav>
          )}
        </section>

        <section aria-labelledby="trade-title">
          <h2 id="trade-title">Trade account</h2>
          <div className={styles.panel}>
            {trade ? (
              <>
                <h3>{trade.status === "approved" ? "Approved for Net 30" : trade.status === "suspended" ? "Trade account suspended" : "Trade account pending"}</h3>
                {trade.status === "suspended" && <p className="muted">You can still view invoices, but you can’t place new orders on account.</p>}
                {trade.status === "approved" && process.env.NET30_CHECKOUT_ENABLED !== "true" && (
                  <p className="muted">Pay on account is currently unavailable at checkout.</p>
                )}
                <dl className={styles.tradeFacts}>
                  <div><dt>Available credit</dt><dd className={styles.figure}>{formatGbp(trade.availableCreditPence)}</dd></div>
                  <div><dt>Outstanding balance</dt><dd className={styles.figure}>{formatGbp(trade.outstandingBalancePence)}</dd></div>
                </dl>
              </>
            ) : tradeResult.status === "rejected" ? (
              <p>We couldn’t load your trade account. Try again shortly.</p>
            ) : applicationResult.status === "rejected" ? (
              <p>We couldn’t load your trade application status. Try again shortly.</p>
            ) : status ? (
              <>
                <h3>{applicationStatus[status].title}</h3>
                <p className="muted">{applicationStatus[status].detail}</p>
                {status === "approved" && (
                  <dl className={styles.tradeFacts}>
                    <div><dt>Available credit</dt><dd>Not available yet</dd></div>
                    <div><dt>Outstanding balance</dt><dd>Not available yet</dd></div>
                    <div><dt>Invoices and PO references</dt><dd>Not available yet</dd></div>
                  </dl>
                )}
              </>
            ) : (
              <>
                <p>No trade application submitted.</p>
                <Link className="textlink" href="/trade">Apply for a trade account</Link>
              </>
            )}
          </div>
          {trade && (
            <section className={styles.invoiceSection} aria-labelledby="invoices-title">
              <h3 id="invoices-title">Invoices and PO references</h3>
              {invoiceResult.status === "rejected" ? <p className="muted">We couldn’t load your invoices. Try again shortly.</p>
                : invoices?.invoices.length ? (
                  <ul className={styles.invoiceList} role="list">
                    {invoices.invoices.map((invoice) => (
                      <li key={invoice.order_id}>
                        <div className={styles.invoiceHeader}>
                          <p className={styles.reference}>PO {invoice.po_number}</p>
                          <p className={styles.figure}>{formatGbp(invoice.amount_remaining_pence)} remaining</p>
                        </div>
                        {invoice.cancelled ? (
                          <p>Cancelled, do not pay · {tradeInvoiceLabels[invoice.status]}</p>
                        ) : (
                          <p className="muted">{tradeInvoiceLabels[invoice.status]} · Due <time dateTime={invoice.due_at}>{accountDate(invoice.due_at)}</time></p>
                        )}
                        <div className={styles.invoiceLinks}>
                          {invoice.url && <a className="textlink" href={invoice.url} rel="noreferrer" aria-label={`View invoice for PO ${invoice.po_number}`}>View invoice</a>}
                          <Link href={`/account/orders/${invoice.order_id}`} prefetch={false} className="textlink" aria-label={`View order for PO ${invoice.po_number}`}>View order</Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted">{invoicePage === 1 ? "No invoices yet." : "There are no invoices on this page."}</p>}
              {(invoicePage > 1 || invoices?.hasOlder) && (
                <nav className={styles.actions} aria-label="Invoice pages">
                  {invoicePage > 1 && <Link className="textlink" href={accountPage(page, invoicePage - 1)}>Newer invoices</Link>}
                  {invoices?.hasOlder && <Link className="textlink" href={accountPage(page, invoicePage + 1)}>Older invoices</Link>}
                </nav>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
