"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { BasketLine } from "@/lib/commerce";
import { useSelection } from "./selection-provider";
import { DispatchNotice, useDispatchNotice } from "./dispatch-notice";
import { DeliveryEstimate, SelectionLineIdentity, SelectionLinePrice, SelectionTotals } from "./selection-summary";
import { useSelectionQuote } from "./use-selection-quote";

export function SelectionTrigger() {
  const { lines, hydrated, open } = useSelection();
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <button
      type="button"
      id="selection-trigger"
      className="tray-trigger"
      aria-label={`Basket ${count.toLocaleString("en-GB")} ${count === 1 ? "blade" : "blades"}`}
      aria-haspopup="dialog"
      disabled={!hydrated}
      onClick={(event) => open(event.currentTarget)}
    >
      <svg className="basket-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9h18l-2.5 11h-13L3 9Zm4 0 3-5m7 5-3-5M9 13l.5 3m5.5-3-.5 3" />
      </svg>
      <span className="tray-label">Basket</span>{" "}
      <span className="tray-count" aria-hidden="true">{count > 999 ? "999+" : count}</span>
    </button>
  );
}

function SelectionItem({
  line, name, value, vatRate, photo, remove, onChange, onUpdate,
}: {
  line: BasketLine;
  name?: string;
  value: string;
  vatRate: number;
  photo?: string;
  remove: (id: string) => void;
  onChange: (value: string) => void;
  onUpdate: (quantity: number) => void;
}) {
  const id = useId();
  const valid = Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2_147_483_647;

  function update(event: FormEvent) {
    event.preventDefault();
    if (valid) onUpdate(Number(value));
  }

  return (
    <li className="tray-row">
      {photo
        ? <Image className="tray-plate" src={`/photos/${photo}`} alt="" width={56} height={44} unoptimized />
        : <span className="tray-plate" aria-hidden="true" />}
      <div className="tray-line">
        <SelectionLineIdentity line={line} name={name} />
        <SelectionLinePrice line={line} vatRate={vatRate} />
        <form className="tray-quantity" onSubmit={update} noValidate>
          <label htmlFor={id}>Quantity<span className="sr"> for {line.sku}</span></label>
          <input
            id={id}
            className="qty-input"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={value}
            aria-invalid={!valid || undefined}
            aria-describedby={!valid ? id + "-error" : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
          <button type="submit" className="textlink" aria-label={`Update quantity for ${line.sku}`} disabled={!valid}>
            Update
          </button>
          {!valid && <p id={id + "-error"} className="fine tray-quantity-error">Enter a positive whole quantity.</p>}
        </form>
      </div>
      <button type="button" className="remove-btn textlink" aria-label={`Remove ${line.sku}`} onClick={() => remove(line.variantId)}>
        Remove
      </button>
    </li>
  );
}

export function SelectionDialog() {
  const { lines, opened, close, replace, setQuantity } = useSelection();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const opener = useRef<HTMLElement | undefined>(undefined);
  const backdropDown = useRef(false);
  const browsing = useRef<HTMLButtonElement>(null);
  const { previousQuote, quote, clock, pending, retry } = useSelectionQuote(lines, !!opened && lines.length > 0);
  const dispatch = useDispatchNotice(quote, clock, retry);
  const displayed = quote ?? (pending ? previousQuote : undefined);
  const priced = displayed?.status === "ok" ? displayed : null;
  const current = quote?.status === "ok" ? quote : null;
  const corrections = current?.corrections ?? [];
  const basket = priced?.basket;
  const hasDraft = lines.some(({ variantId, quantity }) => drafts[variantId] !== undefined && Number(drafts[variantId]) !== quantity);

  useEffect(() => {
    if (!opened || !dialog.current || dialog.current.open) return;
    opener.current = opened.from;
    dialog.current.showModal();
    if (content.current) content.current.scrollTop = 0;
  }, [opened]);

  function changeDraft(id: string, value?: string) {
    setDrafts((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  function remove(id: string) {
    const targets = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>(".remove-btn") ?? []);
    const index = targets.indexOf(document.activeElement as HTMLButtonElement);
    (targets[index + 1] ?? targets[index - 1] ?? browsing.current)?.focus();
    changeDraft(id);
    setQuantity(id, 0);
  }

  return (
    <dialog
      ref={dialog}
      className="selection-dialog"
      aria-labelledby="selection-title"
      onPointerDown={(event) => { backdropDown.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (backdropDown.current && event.target === event.currentTarget) event.currentTarget.close();
        backdropDown.current = false;
      }}
      onClose={() => {
        close();
        retry();
        setDrafts({});
        const from = opener.current;
        if (from?.isConnected) from.focus({ preventScroll: true });
        else document.getElementById("selection-trigger")?.focus({ preventScroll: true });
      }}
    >
      <div className="dialog-wrap">
        <div className="dialog-heading">
          <button type="button" className="x-close" aria-label="Close basket" onClick={() => dialog.current?.close()}>×</button>
          <h2 id="selection-title">Your basket</h2>
        </div>
        <div ref={content} className="dialog-scroll" role="region" aria-label="Basket details" tabIndex={0}>
          {!lines.length && <p className="tray-empty">Your basket is empty. Choose a blade from the catalogue to compare quantities and prices.</p>}
          <div role="status">
            {pending && <p className="fine">Checking current prices and availability…</p>}
            {hasDraft && <p className="fine">Use Update to apply quantity changes before continuing.</p>}
            {quote?.status === "error" && <p className="fine">{quote.message}</p>}
            {corrections.length > 0 && (
              <div className="selection-notice">
                <p>Review the changes to your basket before continuing.</p>
                <ul>{corrections.map((message, index) => <li key={index}>{message}</li>)}</ul>
              </div>
            )}
          </div>
          {quote?.status === "error" && (
            <div className="tray-recovery">
              <button type="button" className="secondary tray-action" onClick={retry}>Retry prices</button>
              <button type="button" className="textlink" onClick={() => {
                browsing.current?.focus();
                replace([]);
              }}>Clear basket</button>
            </div>
          )}
          {priced && basket && (
            <>
              <ul className="selection-lines">
                {basket.lines.map((line) => {
                  const original = lines.find(({ variantId }) => variantId === line.variantId);
                  if (!original) return null;
                  return (
                    <SelectionItem key={line.variantId} line={line} name={priced.productNames?.[line.variantId]}
                      value={drafts[line.variantId] ?? String(priced.corrections.length ? line.quantity : original.quantity)}
                      vatRate={basket.vatRateBasisPoints / 100} photo={priced.photos?.[line.variantId]} remove={remove}
                      onChange={(value) => changeDraft(line.variantId, value)}
                      onUpdate={(quantity) => {
                        changeDraft(line.variantId);
                        setQuantity(line.variantId, quantity);
                      }} />
                  );
                })}
              </ul>
              <SelectionTotals quote={priced} />
            </>
          )}
          <DispatchNotice copy={corrections.length === 0 ? dispatch : null} />
          {priced && basket && <DeliveryEstimate quote={priced} current={!!dispatch} />}
        </div>
        <div className="dialog-actions">
          {corrections.length > 0 && current ? (
            <button type="button" className="primary full tray-action" onClick={() => {
              browsing.current?.focus();
              setDrafts({});
              replace(current.lines);
            }}>
              Accept changes
            </button>
          ) : current?.basket && pathname !== "/checkout" && (
            hasDraft
              ? <button type="button" className="primary full tray-action" disabled>Go to checkout</button>
              : <Link href="/checkout" className="primary full tray-action" onClick={() => dialog.current?.close()}>Go to checkout</Link>
          )}
          <button type="button" ref={browsing} className="secondary tray-action" onClick={() => dialog.current?.close()}>
            {pathname === "/checkout" ? "Return to checkout" : "Continue browsing"}
          </button>
          {pathname !== "/quick-order" && (
            <Link href="/quick-order" className="secondary tray-action" onNavigate={() => dialog.current?.close()}>Quick order</Link>
          )}
        </div>
      </div>
    </dialog>
  );
}
