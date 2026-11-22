"use client";

import { useEffect, useRef, useState } from "react";
import { useSelection } from "@/components/selection-provider";
import type { ReorderReview } from "@/lib/account/reorder";
import { formatGbp } from "@/lib/commerce/money";
import styles from "../../account.module.css";
import { reviewReorder } from "./actions";

export function Reorder({ orderId }: { orderId: string }) {
  const selection = useSelection();
  const [preview, setPreview] = useState<{ result: ReorderReview; revision: number }>();
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const start = useRef<HTMLButtonElement>(null);
  const open = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (added) open.current?.focus();
    else if (preview) heading.current?.focus();
  }, [preview, added]);

  async function check() {
    const revision = selection.revision;
    setPending(true);
    setAdded(false);
    try {
      setPreview({ result: await reviewReorder(orderId), revision });
    } catch {
      setPreview({ result: { status: "error", message: "We couldn’t check this reorder. Try again." }, revision });
    } finally {
      setPending(false);
    }
  }

  const review = preview?.result.status === "ok" ? preview.result.review : null;
  const selectionChanged = !!preview && preview.revision !== selection.revision;

  return (
    <div className={styles.reorder}>
      <button type="button" className="primary" ref={start} disabled={!selection.hydrated || pending} onClick={check}>
        {pending ? "Checking stock and prices…" : "Reorder"}
      </button>
      <p role="status" className={added ? styles.actions : "sr"}>{added ? "Your basket has been replaced." : ""}</p>
      {added && (
        <div className={styles.actions}>
          <button type="button" className="textlink" ref={open} onClick={(event) => selection.open(event.currentTarget)}>
            Open basket
          </button>
        </div>
      )}
      {preview && (
        <section className={styles.panel} aria-labelledby="reorder-title" aria-busy={pending}>
          <h3 id="reorder-title" ref={heading} tabIndex={-1}>Review reorder</h3>
          {preview.result.status === "error" && <p role="alert">{preview.result.message}</p>}
          {review && (
            <>
              <p>These are today’s prices and available quantities. Nothing changes until you confirm.</p>
              <ul className={styles.reviewLines} role="list">
                {review.items.map((item) => (
                  <li key={item.id}>
                    <p className={styles.reference}>{item.sku}</p>
                    <p className="muted">{item.optionLabel}</p>
                    {item.current ? (
                      <>
                        {(item.sku !== item.current.sku || item.optionLabel !== item.current.optionLabel) && (
                          <p>Current listing: {item.current.sku} · {item.current.optionLabel}</p>
                        )}
                        {item.previousQuantity !== item.current.quantity && (
                          <p>Quantity reduced from {item.previousQuantity} to {item.current.quantity} because of limited stock.</p>
                        )}
                        {item.previousUnitPence !== item.current.unitPence && (
                          <p>Unit price changed from {formatGbp(item.previousUnitPence)} to {formatGbp(item.current.unitPence)} ex VAT.</p>
                        )}
                        <p className={styles.figure}>
                          {item.current.quantity} × {formatGbp(item.current.unitPence)} · {formatGbp(item.current.totalPence)} ex VAT
                        </p>
                      </>
                    ) : <p>Out of stock or no longer sold. This item won’t be added.</p>}
                  </li>
                ))}
              </ul>
              {review.lines.length ? (
                <>
                  <p>Goods subtotal: <strong className={styles.figure}>{formatGbp(review.goodsNetPence)}</strong> ex VAT</p>
                  <p className="muted">{selection.lines.length ? "Confirming will replace every item in your current basket." : "Confirming will add the available items to your empty basket."}</p>
                  {selectionChanged && <p role="status">Your basket changed. Check the reorder again before replacing it.</p>}
                </>
              ) : <p>None of these items can be added. Your basket will stay as it is.</p>}
            </>
          )}
          <div className={styles.actions}>
            {review && review.lines.length > 0 && (
              <button type="button" className="primary" disabled={pending || selectionChanged} onClick={() => {
                selection.replace(review.lines);
                setPreview(undefined);
                setAdded(true);
              }}>Replace basket</button>
            )}
            <button type="button" className="secondary" disabled={pending} onClick={() => {
              setPreview(undefined);
              start.current?.focus();
            }}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}
