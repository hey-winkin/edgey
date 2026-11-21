import type { Metadata } from "next";
import Link from "next/link";
import { accountDate, tradeInvoiceLabels } from "@/lib/account/display";
import { getBuyerInvoiceUrl, getBuyerNet30Order } from "@/lib/account/server";
import { CheckoutStatus } from "../../success/checkout-status";
import { ConfirmedOrderSummary } from "../../success/order-summary";
import styles from "../../success/success.module.css";
import { ClearInvoicedSelection } from "./clear-invoiced-selection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order confirmation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function Net30ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getBuyerNet30Order(id).catch(() => "unavailable" as const);
  const order = result === "unavailable" ? null : result;
  const invoice = order?.invoices[0];
  const cancelled = order?.fulfilment_status === "cancelled";
  const lateInvoice = cancelled && invoice && !order?.authorised_at && !["voided", "credited"].includes(invoice.status);
  const kind = result === "unavailable" ? "unavailable" : !order ? "not-found"
    : lateInvoice ? "review" : cancelled ? invoice ? "cancelled-issued" : "expired"
      : invoice && order.authorised_at ? "confirmed" : "pending";
  const issued = kind === "confirmed" || kind === "cancelled-issued" ? order : null;
  const invoiceUrl = kind === "confirmed" && issued ? await getBuyerInvoiceUrl(issued.id) : null;
  const lines = issued?.order_items.map((item) => ({
    variantId: item.variant_id, sku: item.sku, optionLabel: item.option_label, quantity: item.quantity,
    unitPricePence: item.unit_price_pence, netPence: item.net_pence,
  }));

  return (
    <main id="main-content" tabIndex={-1} className="frame simple-page">
      <p className="kicker"><span className="register" aria-hidden="true" /> Trade orders · Net 30</p>
      <CheckoutStatus kind={kind} method="net30" />
      {issued && lines && (
        <>
          <ClearInvoicedSelection orderId={issued.id} lines={lines.map(({ variantId, quantity }) => ({ variantId, quantity }))} />
          <dl className={`specs ${styles.details}`}>
            <dt>Order reference</dt><dd className={styles.figure}>{issued.order_reference}</dd>
            <dt>PO reference</dt><dd className={styles.figure}>{issued.po_number}</dd>
            {kind === "cancelled-issued" && invoice && <><dt>Invoice status</dt><dd>{tradeInvoiceLabels[invoice.status]}</dd></>}
            {!cancelled && <>
              <dt>Dispatch date</dt><dd>
                <time dateTime={issued.dispatched_at ?? issued.promised_dispatch_date}>
                  {accountDate(issued.dispatched_at ?? issued.promised_dispatch_date)}
                </time>
              </dd>
              <dt>Estimated delivery</dt><dd><time dateTime={issued.estimated_delivery_date}>{accountDate(issued.estimated_delivery_date)}</time></dd>
              <dt>Delivery service</dt><dd>{issued.delivery_service}</dd>
            </>}
          </dl>
          <ConfirmedOrderSummary order={{
            goodsNetPence: issued.goods_net_pence, deliveryNetPence: issued.delivery_net_pence,
            vatRateBps: issued.vat_rate_bps, vatPence: issued.vat_pence, grossPence: issued.gross_pence, lines,
          }} totalLabel="Total invoiced inc VAT" />
        </>
      )}
      <div className="empty-actions">
        {invoiceUrl && <a className="textlink" href={invoiceUrl} rel="noreferrer">View invoice</a>}
        {kind === "expired" && <Link className="textlink" href="/checkout" prefetch={false}>Back to checkout</Link>}
        <Link className="textlink" href={order ? `/account/orders/${order.id}` : "/account"} prefetch={false}>
          {order ? "View order in your account" : "Go to your account"}
        </Link>
        <Link className="textlink" href="/blades" prefetch={false}>Continue browsing</Link>
      </div>
    </main>
  );
}
