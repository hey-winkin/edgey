import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { accountDate, fulfilmentLabels, orderPaymentLabel } from "@/lib/account/display";
import { getBuyerInvoiceUrl, getBuyerOrder } from "@/lib/account/server";
import { getVerifiedBuyer } from "@/lib/auth/server";
import { formatGbp } from "@/lib/commerce";
import styles from "../../account.module.css";
import { Reorder } from "./reorder";

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  if (!await getVerifiedBuyer()) redirect("/account");
  const order = await getBuyerOrder((await params).id);
  if (!order) notFound();

  const invoiceUrl = await getBuyerInvoiceUrl(order.id);
  const showEstimate = order.dispatched_at || order.fulfilment_status === "picking" || order.fulfilment_status === "ready_to_pick";
  const address = [order.recipient_name, order.business_name, order.address_line1, order.address_line2,
    order.address_town, order.address_region, order.address_postcode, "United Kingdom"].filter(Boolean);

  return (
    <main id="main-content" tabIndex={-1} className={`frame ${styles.page}`}>
      <Link href="/account" className={`textlink ${styles.back}`}>Back to account</Link>
      <header className={styles.header}>
        <div>
          <p className="kicker"><span className="register" aria-hidden="true" /> Order record</p>
          <h1>Order details</h1>
          <p className={styles.reference}>{order.order_reference}</p>
        </div>
        <dl className={styles.orderMeta}>
          <div><dt>Placed</dt><dd><time dateTime={order.created_at} className={styles.figure}>{accountDate(order.created_at)}</time></dd></div>
          <div><dt>Payment</dt><dd>{orderPaymentLabel(order.payment_status, order.fulfilment_status)}</dd></div>
          <div><dt>Fulfilment</dt><dd>{fulfilmentLabels[order.fulfilment_status]}</dd></div>
          {order.payment_method === "net30" && <div><dt>PO reference</dt><dd className={styles.figure}>{order.po_number}</dd></div>}
        </dl>
      </header>

      <div className={styles.columns}>
        <section aria-labelledby="items-title">
          <h2 id="items-title">Order items</h2>
          <ul className={styles.lines} role="list">
            {order.order_items.map((item) => (
              <li className={styles.panel} key={item.variant_id}>
                <p className={styles.reference}>{item.sku}</p>
                <p className="muted">{item.option_label}</p>
                <dl className={styles.facts}>
                  <div><dt>Quantity</dt><dd className={styles.figure}>{item.quantity}</dd></div>
                  <div><dt>Unit price ex VAT</dt><dd className={styles.figure}>{formatGbp(item.unit_price_pence)}</dd></div>
                  <div><dt>Line total</dt><dd className={styles.figure}>{formatGbp(item.net_pence)} ex VAT<br />{formatGbp(item.gross_pence)} inc VAT</dd></div>
                </dl>
              </li>
            ))}
          </ul>
          <dl className={styles.totals}>
            <div><dt>Goods ex VAT</dt><dd>{formatGbp(order.goods_net_pence)}</dd></div>
            <div><dt>Delivery ex VAT</dt><dd>{formatGbp(order.delivery_net_pence)}</dd></div>
            <div><dt>VAT</dt><dd>{formatGbp(order.vat_pence)}</dd></div>
            <div><dt>Total inc VAT</dt><dd>{formatGbp(order.gross_pence)}</dd></div>
          </dl>
          {order.order_items.length > 0 && <Reorder orderId={order.id} />}
        </section>

        <section aria-labelledby="delivery-title">
          <h2 id="delivery-title">Delivery</h2>
          <div className={styles.panel}>
            <h3>Delivery address</h3>
            <address>{address.map((line, index) => <div key={index}>{line}</div>)}</address>
            <dl className={styles.tradeFacts}>
              <div><dt>Service</dt><dd>{order.delivery_service}</dd></div>
              <div><dt>Dispatch date</dt><dd>{order.dispatched_at ? (
                <time dateTime={order.dispatched_at} className={styles.figure}>{accountDate(order.dispatched_at)}</time>
              ) : showEstimate ? (
                <>Expected <time dateTime={order.promised_dispatch_date} className={styles.figure}>{accountDate(order.promised_dispatch_date)}</time></>
              ) : "Not dispatched"}</dd></div>
              {showEstimate && (
                <div><dt>Estimated delivery</dt><dd><time dateTime={order.estimated_delivery_date} className={styles.figure}>{accountDate(order.estimated_delivery_date)}</time></dd></div>
              )}
              {order.dispatched_at && (
                <>
                  <div><dt>Carrier</dt><dd>{order.carrier}</dd></div>
                  <div><dt>Tracking number</dt><dd className={styles.reference}>{order.tracking_number}</dd></div>
                </>
              )}
            </dl>
          </div>
          {invoiceUrl && (
            <p className={styles.actions}><a className="textlink" href={invoiceUrl} rel="noreferrer">View invoice</a></p>
          )}
        </section>
      </div>
    </main>
  );
}
