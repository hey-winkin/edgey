import { formatGbp } from "@/lib/commerce";
import styles from "./success.module.css";

const vatRateFormat = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 2 });

type ConfirmedTotals = { goodsNetPence: number; deliveryNetPence: number; vatRateBps: number; vatPence: number; grossPence: number };
type ConfirmedLine = { variantId: string; sku: string; optionLabel: string; quantity: number; unitPricePence: number; netPence: number };

export function ConfirmedOrderSummary({ order, totalLabel }: {
  order: ConfirmedTotals & { lines: ConfirmedLine[] };
  totalLabel: string;
}) {
  return (
    <section aria-labelledby="order-summary" className={styles.summary}>
      <h2 id="order-summary" className={styles.summaryHeading}>Order summary</h2>
      <ul className={styles.lines} role="list">
        {order.lines.map((line) => (
          <li key={line.variantId} className={styles.line}>
            <div className={styles.item}>
              <p className={styles.code}>{line.sku}</p>
              <p>{line.optionLabel}</p>
              <p className={styles.unit}>{line.quantity} × {formatGbp(line.unitPricePence)} ex VAT</p>
            </div>
            <p className={styles.figure}>{formatGbp(line.netPence)}</p>
          </li>
        ))}
      </ul>
      <dl className={styles.totals}>
        <div><dt>Subtotal ex VAT</dt><dd>{formatGbp(order.goodsNetPence)}</dd></div>
        <div><dt>Delivery ex VAT</dt><dd>{formatGbp(order.deliveryNetPence)}</dd></div>
        <div><dt>VAT ({vatRateFormat.format(order.vatRateBps / 10_000)})</dt><dd>{formatGbp(order.vatPence)}</dd></div>
        <div className={styles.total}><dt>{totalLabel}</dt><dd>{formatGbp(order.grossPence)}</dd></div>
      </dl>
    </section>
  );
}
