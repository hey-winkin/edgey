"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { useSelection } from "@/components/selection-provider";
import { productHref } from "@/lib/catalogue";
import { formatUnitPriceExVat } from "@/lib/commerce";
import { choiceField, isReady, MAX_QUICK_ORDER_LINES, type Blade, type ResultLine } from "@/lib/quick-order/order";
import { checkQuickOrder, confirmQuickOrder } from "./actions";
import styles from "./quick-order.module.css";

const initial = { id: "", text: "", rows: [] };
const tiers: Record<number, string> = { 1: "1–4 blades", 5: "5–9 blades", 10: "10+ blades" };

function bladeDescription(blade: Blade) {
  return [...new Set([blade.name, blade.optionLabel, blade.tool].filter(Boolean))].join(" · ");
}

function LineResult({ row, added, failure, adding }: {
  row: ResultLine;
  added: boolean;
  failure?: string;
  adding: boolean;
}) {
  const issue = failure ?? row.issue;
  return (
    <li className={styles.row}>
      <p className={styles.rowCode}>
        <span className="muted">Line {row.number}</span>
        <span>{"code" in row ? row.code : row.input}</span>
        {"quantity" in row && <span className="muted">× {row.quantity.toLocaleString("en-GB")}</span>}
      </p>
      {"blade" in row && row.blade && (
        <p>
          <Link className="textlink" href={productHref(row.blade.slug, row.blade.sku)}>
            {row.blade.name}
          </Link>
          <span className={styles.bladeDetails}>{
            [...new Set([row.blade.sku, row.blade.optionLabel, row.blade.tool].filter(Boolean))].join(" · ")
          }</span>
        </p>
      )}
      {"candidates" in row && row.candidates.length > 1 && !added && (
        <div className={styles.choice}>
          <label htmlFor={`order-line-choice-${row.number}`}>Choose a blade for line {row.number}</label>
          <select id={`order-line-choice-${row.number}`} name={choiceField(row)}
            defaultValue={row.chosen ? row.blade?.id : ""} disabled={adding}
            aria-describedby={`order-line-status-${row.number}`}>
            <option value="">Choose a blade</option>
            {row.candidates.map((blade) => (
              <option key={blade.id} value={blade.id}>{blade.sku} · {bladeDescription(blade)}</option>
            ))}
          </select>
        </div>
      )}
      <p id={`order-line-status-${row.number}`} className={styles.rowStatus}>
        <span>{added ? "Added to basket." : issue ?? "In stock."}</span>
        {"price" in row && row.price && !added && (
          <span className={styles.price}>
            {formatUnitPriceExVat(row.price.unit)}
            <small>{tiers[row.price.minimum]} tier{row.price.combinedQuantity !== row.quantity && ` · ${row.price.combinedQuantity.toLocaleString("en-GB")} combined`}</small>
          </span>
        )}
      </p>
    </li>
  );
}

export function QuickOrderForm() {
  const [review, check, checking] = useActionState(checkQuickOrder, initial, "/quick-order");
  const { hydrated, lines, revision, replaceIfUnchanged, open } = useSelection();
  const [changed, setChanged] = useState("");
  const [adding, setAdding] = useState(false);
  const [outcome, setOutcome] = useState<{
    id: string;
    added?: number[];
    quantity?: number;
    failures?: Record<number, string>;
    error?: string;
  }>();
  const current = outcome?.id === review.id ? outcome : undefined;
  const added = current?.added ?? [];
  const ready = review.rows.filter(isReady).filter(({ number }) => !added.includes(number) && !current?.failures?.[number]);
  const needsAttention = review.rows.length - ready.length - added.length;
  const hasChoices = review.rows.some((row) => "candidates" in row && row.candidates.length > 1 && !added.includes(row.number));
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const draft = useRef<HTMLTextAreaElement>(null);
  const dirty = !!review.id && changed === review.id;

  useEffect(() => {
    if (review.id) heading.current?.focus();
  }, [review.id]);

  useEffect(() => {
    if (current) feedback.current?.focus();
  }, [current]);

  async function add() {
    if (dirty || checking || adding || !hydrated || !ready.length) return;
    setAdding(true);
    try {
      const result = await confirmQuickOrder(ready.map(({ number, code, quantity, blade, chosen }) => ({
        number, code, quantity, chosen, variantId: blade.id,
      })), lines);
      if ("error" in result || !result.added || !result.lines) {
        setOutcome({ id: review.id, added, quantity: current?.quantity, error: result.error });
        return;
      }
      if (result.added.length && !await replaceIfUnchanged(result.lines, revision)) {
        setOutcome({ id: review.id, added, quantity: current?.quantity, error: "We couldn’t update your basket. Check it and try adding again." });
        return;
      }
      const nowAdded = [...added, ...result.added.map(({ number }) => number)];
      if (draft.current && result.added.length) {
        const removed = new Set(nowAdded);
        draft.current.value = review.text.split(/\r\n?|\n/).map((line, index) => removed.has(index + 1) ? "" : line).join("\n").trimEnd();
      }
      setOutcome({
        id: review.id,
        added: nowAdded,
        quantity: (current?.quantity ?? 0) + result.added.reduce((sum, line) => sum + line.quantity, 0),
        failures: { ...current?.failures, ...Object.fromEntries(result.failures.map(({ number, issue }) => [number, issue])) },
      });
    } catch {
      setOutcome({ id: review.id, added, quantity: current?.quantity, error: "We couldn’t add these blades. Try again." });
    } finally {
      setAdding(false);
    }
  }

  return (
    <form action={check} className={styles.order} onChange={() => setChanged(review.id)} onReset={(event) => event.preventDefault()}>
      <input type="hidden" name="basket" value={JSON.stringify(lines)} />
      <div className={styles.entry}>
        <label htmlFor="quick-order-lines">Part numbers and quantities</label>
        <p className="muted" id="quick-order-format">
          Type or paste up to {MAX_QUICK_ORDER_LINES} lines. Put one part number and quantity on each line, separated by a tab, comma or space.
        </p>
        <textarea ref={draft} key={review.id} id="quick-order-lines" name="lines" defaultValue={review.text}
          rows={7} spellCheck={false} autoCapitalize="off" readOnly={adding || checking}
          aria-invalid={review.invalidInput && !dirty ? true : undefined}
          aria-describedby={`quick-order-format quick-order-example${review.error && !dirty ? " quick-order-error" : ""}`} />
        <p id="quick-order-example" className={styles.example}>Format: <code>PART-NUMBER, 5</code></p>
        <button type="submit" className="primary" disabled={checking || adding}>
          {checking ? "Checking…" : "Check lines"}
        </button>
      </div>
      <section className={styles.results} aria-labelledby="quick-order-results">
        <h2 tabIndex={-1} ref={heading} id="quick-order-results">{review.id ? "Checked lines" : "Before you add"}</h2>
        {!review.id && <p className="muted">Check the blade, quantity, price and availability for each line before adding to your basket.</p>}
        {review.error && <p id="quick-order-error" role="status">{review.error}</p>}
        {!!review.rows.length && (
          <>
            <p className={styles.summary}>
              {ready.length} {ready.length === 1 ? "line" : "lines"} ready to add
              {needsAttention > 0 && ` · ${needsAttention} need${needsAttention === 1 ? "s" : ""} attention`}
            </p>
            <p className="muted">To correct a line, <a className="textlink" href="#quick-order-lines">edit your list</a> and check again. Basket prices combine quantities of the same blade.</p>
            <ol role="list" className={styles.rows}>
              {review.rows.map((row) => (
                <LineResult key={`${review.id}:${row.number}`} row={row} added={added.includes(row.number)}
                  failure={current?.failures?.[row.number]} adding={adding} />
              ))}
            </ol>
            {dirty && <p className="muted" role="status">Check the lines again to apply your changes.</p>}
            {current && (
              <p className={styles.feedback} tabIndex={-1} ref={feedback} role="status">
                {current.error ?? (current.quantity ? `Added ${current.quantity.toLocaleString("en-GB")} ${current.quantity === 1 ? "blade" : "blades"} to your basket.` : "No blades were added. Review the lines above.")}
              </p>
            )}
            <div className={styles.actions}>
              {ready.length > 0 && hydrated && (
                <button type="button" className="primary" disabled={dirty || checking || adding} onClick={add}>
                  {adding ? "Checking stock…" : "Add ready lines to basket"}
                </button>
              )}
              {hasChoices && <button type="submit" className="secondary" disabled={checking || adding}>Check choices</button>}
              {!!added.length && <button type="button" className="secondary" onClick={(event) => open(event.currentTarget)}>View basket</button>}
            </div>
            {!ready.length && !added.length && <p className="muted">No lines are ready to add.</p>}
            {ready.length > 0 && <noscript><p className="muted">Your lines are checked. Enable JavaScript to add them to your basket.</p></noscript>}
          </>
        )}
      </section>
    </form>
  );
}
