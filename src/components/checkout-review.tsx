"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Net30CheckoutResult } from "@/app/api/checkout/net30/route";
import type { CheckoutSessionResult } from "@/app/api/checkout/session/route";
import { withCheckoutAttemptLock } from "@/app/(shop)/checkout/attempt-lock";
import {
  clearNet30Attempt, net30AttemptKey, net30SelectionScope, readNet30Attempt, rememberNet30Order, startNet30Attempt, type ActiveNet30,
} from "@/app/(shop)/checkout/net30-attempt";
import { captureCheckoutSelection, rememberCheckoutSelection } from "@/app/(shop)/checkout/success/selection-handoff";
import { forgetCheckoutAttempt, materialValue, prepareCheckoutToken } from "@/lib/checkout/attempt-token";
import type { CheckoutFields } from "@/lib/checkout/types";
import { formatGbp, parseUkPostcode, type LineRequest } from "@/lib/commerce";
import { activePaymentKey, readActivePayment, sameActivePayment, storeActivePayment, type ActivePayment } from "@/lib/payments/checkout-attempt-client";
import { CheckoutPaymentMethod, tradeUnavailableMessage, type CheckoutTrade, type TradeUnavailableReason } from "./checkout-payment-method";
import styles from "./checkout-payment-method.module.css";
import { useSelection } from "./selection-provider";
import { DispatchEstimate, SelectionLineIdentity, SelectionLinePrice, SelectionTotals } from "./selection-summary";
import { useSelectionQuote } from "./use-selection-quote";

const initialFields: CheckoutFields = {
  businessName: "", email: "", buyingForWork: false,
  recipientName: "", line1: "", line2: "", town: "", region: "", postcode: "",
};

const fields = {
  businessName: { label: "Business name", autoComplete: "organization" },
  email: { label: "Contact email", autoComplete: "email", type: "email" },
  recipientName: { label: "Recipient name", autoComplete: "shipping name" },
  line1: { label: "Address line 1", autoComplete: "shipping address-line1" },
  line2: { label: "Address line 2 (optional)", autoComplete: "shipping address-line2", optional: true },
  town: { label: "Town or city", autoComplete: "shipping address-level2" },
  region: { label: "County (optional)", autoComplete: "shipping address-level1", optional: true },
  postcode: { label: "Postcode", autoComplete: "shipping postal-code" },
} satisfies Record<Exclude<keyof CheckoutFields, "buyingForWork">, {
  label: string; autoComplete: string; type?: string; optional?: boolean;
}>;

type FieldName = keyof typeof fields;
type SubmitResult = Exclude<CheckoutSessionResult, { status: "payment" } | { status: "closed" } | { status: "invalid" }>
  | { status: "invalid"; errors: Partial<Record<keyof CheckoutFields | "poReference", string>>; message: string };

async function paymentRequest(input: unknown): Promise<CheckoutSessionResult>;
async function paymentRequest(input: unknown, method: "net30"): Promise<Net30CheckoutResult>;
async function paymentRequest(input: unknown, method: "session" | "net30" = "session") {
  const response = await fetch(`/api/checkout/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.json();
}

export function CheckoutReview({ trade }: { trade: CheckoutTrade | null }) {
  const router = useRouter();
  const { hydrated, lines, revision, replace, open } = useSelection();
  const id = useId();
  const [values, setValues] = useState(initialFields);
  const [postcodeBlurred, setPostcodeBlurred] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [active, setActive] = useState<ActivePayment | null>(null);
  const [activeNet30, setActiveNet30] = useState<ActiveNet30 | null>();
  const [method, setMethod] = useState<"card" | "net30">("card");
  const [poReference, setPoReference] = useState("");
  const [tradeFailure, setTradeFailure] = useState<{ reason: TradeUnavailableReason; revision: number; quoteKey?: string }>();
  const [result, setResult] = useState<{ lines: LineRequest[]; value: SubmitResult } | null>(null);
  const attempt = useRef<{ token: string; revision: number; quoteKey: string } | null>(null);
  const memoryCardAttempt = useRef<ActivePayment | null>(null);
  const submitLock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const summaryTitle = useRef<HTMLHeadingElement>(null);
  const parsedPostcode = parseUkPostcode(values.postcode);
  const postcode = parsedPostcode.ok ? parsedPostcode.value.normalised : undefined;
  const { quote, pending, previousQuote, retry } = useSelectionQuote(lines, hydrated && lines.length > 0, { postcode });
  const response = result?.lines === lines ? result.value : undefined;
  const shown = response?.status === "review" ? response.quote : quote ?? (pending ? previousQuote : undefined);
  const priced = shown?.status === "ok" ? shown : null;
  const productNames = priced?.productNames ?? (quote?.status === "ok" ? quote.productNames : undefined);
  const basket = priced?.basket;
  const corrections = priced?.corrections ?? [];
  const paymentQuoteNote = !pending && (corrections.length > 0 || shown?.status === "error");
  const errors = response?.status === "invalid" ? response.errors : {};
  const unsupported = !pending && priced?.coverage === "unsupported";
  const available = trade && "availableCreditPence" in trade ? trade.availableCreditPence : undefined;
  const gross = basket?.totalGrossPence;
  const estimated = priced?.coverage !== "covered" || pending;
  const accountFailure = tradeFailure?.revision === revision && tradeFailure.quoteKey === priced?.quoteKey
    ? tradeFailure.reason : undefined;
  const tradeStatus = accountFailure ?? (trade?.status === "approved"
    && !estimated && gross !== undefined && available !== undefined && gross > available
    ? "over-limit" : trade?.status);
  const net30Allowed = tradeStatus === "approved" && !active;
  const coverageError = postcodeBlurred && values.postcode.trim() && !parsedPostcode.ok
    ? "Enter a full UK postcode, for example SW1A 1AA."
    : unsupported ? "Online delivery isn’t available for this postcode."
      : undefined;

  useEffect(() => {
    function restore() {
      setActive(readActivePayment() ?? memoryCardAttempt.current);
      setActiveNet30(readNet30Attempt());
    }
    const frame = requestAnimationFrame(restore);
    function sync(event: StorageEvent) {
      if (event.key === net30AttemptKey || event.key === null) setActiveNet30(readNet30Attempt());
      if (event.key === activePaymentKey || event.key === null) setActive(readActivePayment() ?? memoryCardAttempt.current);
    }
    window.addEventListener("storage", sync);
    window.addEventListener("pageshow", restore);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  useEffect(() => {
    if (!response) return;
    const firstError = response.status === "invalid" ? form.current?.querySelector<HTMLInputElement>('input[aria-invalid="true"]') : null;
    (firstError ?? feedback.current)?.focus();
  }, [response]);

  function change<K extends keyof CheckoutFields>(name: K, value: CheckoutFields[K]) {
    if (submitLock.current) return;
    if (attempt.current && materialValue(name, values[name]) !== materialValue(name, value)) {
      attempt.current = null;
      forgetCheckoutAttempt();
    }
    setValues((current) => ({ ...current, [name]: value }));
    setResult(null);
  }

  function field(name: FieldName) {
    const config = fields[name] as (typeof fields)[FieldName] & { type?: string; optional?: boolean };
    const error = errors[name] ?? (name === "postcode" ? coverageError : undefined);
    return (
      <div className={name === "postcode" ? "checkout-field checkout-postcode" : "checkout-field"}>
        <label htmlFor={id + name}>{config.label}</label>
        <input
          id={id + name}
          name={name}
          type={config.type ?? "text"}
          autoComplete={config.autoComplete}
          autoCapitalize={name === "email" ? "none" : name === "postcode" ? "characters" : undefined}
          spellCheck={name === "email" || name === "postcode" ? false : undefined}
          required={!config.optional}
          value={values[name]}
          readOnly={submitting}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? id + name + "-error" : undefined}
          onFocus={name === "postcode" ? () => setPostcodeBlurred(false) : undefined}
          onBlur={name === "postcode" ? () => setPostcodeBlurred(true) : undefined}
          onChange={(event) => change(name, event.target.value)}
        />
        {error && <p className="fine" id={id + name + "-error"}>{error}</p>}
        {name === "postcode" && unsupported && (
          <Link className="textlink" prefetch={false} href={`/enquiry?kind=delivery&postcode=${encodeURIComponent(postcode ?? "")}`}>
            Ask us about delivery
          </Link>
        )}
      </div>
    );
  }

  function blockedByNet30() {
    const current = readNet30Attempt();
    if (!current) return false;
    setActiveNet30(current);
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || activeNet30 !== null || pending || !priced || !basket || corrections.length || unsupported || blockedByNet30()) return;
    if (method === "net30") {
      if (net30Allowed) await submitNet30(priced.quoteKey);
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      const { quoteKey } = priced;
      const current = attempt.current;
      const reusable = current?.revision === revision && current.quoteKey === quoteKey ? current.token : undefined;
      const prepared = await prepareCheckoutToken(quoteKey, values, reusable);
      if (!prepared.stillCurrent()) return;
      const { token } = prepared;
      const capture = await captureCheckoutSelection(lines);
      await prepared.remember();
      const claimed = await withCheckoutAttemptLock(() => {
        if (!prepared.stillCurrent() || blockedByNet30()) return null;
        const previous = readActivePayment() ?? memoryCardAttempt.current;
        if (!sameActivePayment(active, previous)) {
          setActive(previous);
          setResult({ lines, value: { status: "error", message: "Your checkout changed in another tab. Check it before starting a payment." } });
          return null;
        }
        if (previous?.previousToken && token !== previous.token) {
          setResult({ lines, value: { status: "error", message: "Close the previous checkout before starting a new payment." } });
          return null;
        }
        const next = { token, previousToken: previous?.token === token ? previous.previousToken : previous?.token };
        memoryCardAttempt.current = storeActivePayment(next) ? null : next;
        setActive(next);
        return next;
      });
      if (!claimed) return;
      attempt.current = { token, revision, quoteKey };
      const value = await paymentRequest({
        attemptToken: token, lines, fields: values, quoteKey,
        supersedesAttemptToken: claimed.previousToken,
      });
      if (value.status === "payment") {
        const recorded = await updateCardAttempt(claimed, { token, sessionId: value.sessionId });
        if (!recorded) return;
        await rememberCheckoutSelection(value.sessionId, capture);
        if (prepared.stillCurrent()) window.location.assign(value.url);
        return;
      }
      const closed = "attemptClosed" in value && value.attemptClosed;
      if (!("attemptPending" in value && value.attemptPending)) {
        await updateCardAttempt(claimed, closed && active?.token === token ? null : active);
      }
      if (!prepared.stillCurrent() || value.status === "closed") return;
      if (closed) {
        attempt.current = null;
        forgetCheckoutAttempt();
        retry();
      }
      setResult({ lines, value });
    } catch {
      setResult({ lines, value: { status: "error", message: "We couldn’t review your checkout. Try again." } });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function updateCardAttempt(expected: ActivePayment, next: ActivePayment | null) {
    return withCheckoutAttemptLock(() => {
      const current = readActivePayment() ?? memoryCardAttempt.current;
      if (!sameActivePayment(expected, current)) {
        setActive(current);
        return false;
      }
      memoryCardAttempt.current = storeActivePayment(next) ? null : next;
      setActive(next);
      return true;
    });
  }

  async function finishNet30(value: Net30CheckoutResult, attempt: ActiveNet30, action: "submit" | "resume" | "close") {
    if (value.status === "confirming" || value.status === "authorised") {
      const { orderId } = value;
      await rememberNet30Order(attempt.token, orderId);
      await rememberCheckoutSelection(net30SelectionScope(orderId), attempt.selectionNonce);
      router.push(`/checkout/net30/${encodeURIComponent(orderId)}`);
      return;
    }
    const closed = "attemptClosed" in value && value.attemptClosed;
    if (closed || (action === "submit" && (value.status === "invalid" || value.status === "review" || value.status === "trade-unavailable"))) {
      await clearNet30Attempt({ token: attempt.token });
      setActiveNet30(readNet30Attempt());
    }
    if (closed) {
      retry();
      setResult({ lines, value: { status: "error", message: "The account checkout is closed. Review your selection to start again." } });
    } else if (value.status === "trade-unavailable") {
      if (action === "submit") {
        setMethod("card");
        setTradeFailure({ reason: value.reason, revision, quoteKey: priced?.quoteKey });
      }
      setResult({ lines, value: { status: "error", message: tradeUnavailableMessage(value.reason) } });
    } else if ("message" in value) {
      setResult({ lines, value });
    }
  }

  async function submitNet30(quoteKey: string) {
    const po = poReference.trim();
    if (!po || po.length > 200 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(poReference)) {
      setResult({ lines, value: { status: "invalid", errors: { poReference: "Enter a purchase order reference on one line." },
        message: "Check the highlighted details before continuing." } });
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setResult(null);
    let next: ActiveNet30 | null = null;
    try {
      next = await startNet30Attempt(await captureCheckoutSelection(lines));
      setActiveNet30(next ?? readNet30Attempt());
      if (!next) {
        setActive(readActivePayment() ?? memoryCardAttempt.current);
        return;
      }
      const value = await paymentRequest({ attemptToken: next.token, lines, fields: values, quoteKey, poReference: po }, "net30");
      await finishNet30(value, next, "submit");
    } catch {
      const message = next ? "We couldn’t verify your account checkout. Check its status before placing another order."
        : "We couldn’t save your account checkout in this browser. You can still pay by card.";
      setResult({ lines, value: { status: "error", message } });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function recoverNet30(action: "resume" | "close") {
    const current = readNet30Attempt();
    if (submitLock.current) return;
    if (!current) {
      setActiveNet30(null);
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      const value = await paymentRequest({ action, attemptToken: current.token }, "net30");
      await finishNet30(value, current, action);
    } catch {
      setResult({ lines, value: { status: "error", message: "We couldn’t verify your account checkout. Try again." } });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function recover(action: "resume" | "close") {
    if (!active || submitLock.current || blockedByNet30()) return;
    submitLock.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      const capture = await captureCheckoutSelection(lines);
      const ready = await withCheckoutAttemptLock(() => {
        if (blockedByNet30()) return false;
        const current = readActivePayment() ?? memoryCardAttempt.current;
        setActive(current);
        return sameActivePayment(active, current);
      });
      if (!ready) return;
      const value = await paymentRequest({ action, attemptToken: active.token, supersedesAttemptToken: active.previousToken });
      if (value.status === "payment") {
        if (!await updateCardAttempt(active, { token: active.token, sessionId: value.sessionId })) return;
        await rememberCheckoutSelection(value.sessionId, capture);
        window.location.assign(value.url);
      } else if (value.status === "closed" || ("attemptClosed" in value && value.attemptClosed)) {
        if (!await updateCardAttempt(active, null)) return;
        attempt.current = null;
        forgetCheckoutAttempt();
        retry();
        setResult({ lines, value: { status: "error", message: "The previous checkout is closed. Review your selection to start again." } });
      } else {
        setResult({ lines, value });
      }
    } catch {
      setResult({ lines, value: { status: "error", message: "We couldn’t verify the previous checkout. Try again." } });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  if (!hydrated || activeNet30 === undefined) return <p role="status">Loading your selection…</p>;
  if (activeNet30) {
    return (
      <section className={`checkout-panel ${styles.recovery}`} aria-labelledby={id + "-account-recovery"}>
        <h2 id={id + "-account-recovery"}>Account checkout in progress</h2>
        <p className="muted">We may still issue your invoice. Check this checkout before trying another payment method.</p>
        <div className={styles.actions}>
          <button type="button" className="textlink" disabled={submitting} onClick={() => recoverNet30("resume")}>Check account checkout</button>
          <button type="button" className="textlink" disabled={submitting} onClick={() => recoverNet30("close")}>Close account checkout</button>
        </div>
        <p className="fine">You must be signed in to the trade account that started this checkout.</p>
        <Link className="textlink" href="/account">Go to your account</Link>
        <div role="status" ref={feedback} tabIndex={-1}>{submitting ? "Checking your account checkout…" : response?.message}</div>
      </section>
    );
  }
  if (!lines.length) {
    return (
      <section className="checkout-panel checkout-empty">
        <h2>Your selection is empty</h2>
        <p className="fine">Choose a blade from the catalogue to start an order.</p>
        <Link className="primary tray-action" href="/blades">Browse blades</Link>
      </section>
    );
  }

  return (
    <div className="checkout-grid">
      <form ref={form} className="checkout-panel checkout-form" onSubmit={submit} noValidate>
        <fieldset>
          <legend>Business and contact</legend>
          {field("businessName")}
          {field("email")}
          <div className="checkout-field">
            <label className="checkout-check">
              <input
                type="checkbox"
                name="buyingForWork"
                required
                checked={values.buyingForWork}
                aria-disabled={submitting || undefined}
                aria-invalid={!!errors.buyingForWork || undefined}
                aria-describedby={errors.buyingForWork ? id + "-business-error" : undefined}
                onChange={(event) => change("buyingForWork", event.target.checked)}
              />
              I’m buying for work
            </label>
            {errors.buyingForWork && <p className="fine" id={id + "-business-error"}>{errors.buyingForWork}</p>}
          </div>
        </fieldset>
        <fieldset>
          <legend>Delivery address</legend>
          {field("recipientName")}
          {field("line1")}
          {field("line2")}
          <div className="checkout-field-pair">{field("town")}{field("region")}</div>
          {field("postcode")}
          <p className="fine">Delivery country: United Kingdom</p>
        </fieldset>
        {tradeStatus && (
          <CheckoutPaymentMethod id={id} status={tradeStatus} available={available} gross={gross} estimated={estimated}
            method={method} onMethod={(value) => { if (!submitLock.current) { setMethod(value); setResult(null); } }}
            locked={!!active || submitting} po={poReference} poError={errors.poReference}
            onPo={(value) => { if (!submitLock.current) { setPoReference(value); setResult(null); } }} />
        )}
        <div className="checkout-payment">
          {active && (
            <div className="selection-notice">
              <p>There’s a previous card payment attempt in this browser.</p>
              <button type="button" className="textlink" disabled={submitting} onClick={() => recover("resume")}>Resume payment</button>
              {" · "}
              <button type="button" className="textlink" disabled={submitting} onClick={() => recover("close")}>Close previous checkout</button>
            </div>
          )}
          {basket && (priced.coverage === "covered" || priced.coverage === "unchecked") && (
            <p className="checkout-amount"><span>{priced.coverage === "unchecked" ? "Estimated total inc VAT" : "Total inc VAT"}</span>
              <strong>{formatGbp(basket.totalGrossPence)}</strong></p>
          )}
          {paymentQuoteNote && (
            <p id={id + "-payment-quote-note"} className="fine checkout-payment-note">
              {corrections.length > 0 ? "Stock has changed. " : "We couldn’t check your prices. "}
              <a className="textlink" href={"#" + id + "-summary"}>
                {corrections.length > 0 ? "Review changes in your order summary" : "Retry prices in your order summary"}
              </a>
            </p>
          )}
          <button type="submit" className="primary full" aria-disabled={submitting || undefined}
            aria-describedby={paymentQuoteNote ? id + "-payment-quote-note" : undefined}
            disabled={!submitting && (pending || !basket || corrections.length > 0 || unsupported || (method === "net30" && !net30Allowed))}>
            {submitting ? "Checking checkout…" : method === "net30" ? "Place order on account" : "Continue to payment"}
          </button>
          <div role="status" ref={feedback} tabIndex={-1} className="checkout-feedback">
            {response && (
              <p className="fine">{response.message}</p>
            )}
          </div>
        </div>
      </form>

      <section className="checkout-panel checkout-summary" aria-labelledby={id + "-summary"}>
        <div className="checkout-section-head">
          <h2 id={id + "-summary"} ref={summaryTitle} tabIndex={-1}>Order summary</h2>
          <button type="button" className="textlink" aria-haspopup="dialog" disabled={submitting} onClick={(event) => open(event.currentTarget)}>
            Edit selection
          </button>
        </div>
        <div role="status">
          {pending && response?.status !== "review" && <p className={basket ? "sr" : "fine"}>Checking prices and delivery…</p>}
          {shown?.status === "error" && <p className="fine">{shown.message}</p>}
          {response?.status === "review" && <p className="fine">{response.message}</p>}
          {!pending && corrections.length > 0 && (
            <div className="selection-notice">
              <p>Review the changes to your selection before continuing.</p>
              <ul>{corrections.map((message, index) => <li key={index}>{message}</li>)}</ul>
            </div>
          )}
        </div>
        {shown?.status === "error" && <button type="button" className="secondary tray-action" onClick={() => {
          setResult(null);
          retry();
        }}>Retry prices</button>}
        {basket && priced && (
          <div aria-busy={pending}>
            <ul className="selection-lines checkout-lines">
              {basket.lines.map((line) => (
                <li className="tray-line" key={line.variantId}>
                  <SelectionLineIdentity line={line} name={productNames?.[line.variantId]} />
                  <SelectionLinePrice line={line} vatRate={basket.vatRateBasisPoints / 100} />
                </li>
              ))}
            </ul>
            <SelectionTotals quote={priced} />
            {priced.coverage === "unchecked" && <p className="fine">Delivery and the total are estimates until you enter your postcode.</p>}
            <DispatchEstimate quote={priced} onAccount={method === "net30"} />
          </div>
        )}
        {!pending && corrections.length > 0 && priced && (
          <button type="button" className="secondary tray-action" onClick={() => {
            summaryTitle.current?.focus();
            setResult(null);
            replace(priced.lines);
          }}>Accept changes</button>
        )}
      </section>
    </div>
  );
}
