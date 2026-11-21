"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import styles from "./success.module.css";

const copy = {
  confirmed: {
    heading: "Order confirmed",
    details: "We’ll email your order confirmation, with the invoice link when it’s available.",
  },
  pending: {
    heading: "Confirming payment",
    details: "We’re waiting for confirmation. You don’t need to pay again.",
  },
  expired: {
    heading: "This checkout has expired",
    details: "We don’t have a confirmed payment for this checkout.",
  },
  review: {
    heading: "Your payment is under review",
    details: "Your order isn’t confirmed yet. Please don’t pay again while we review it.",
  },
  "cancelled-refunded": {
    heading: "This order was cancelled and refunded",
    details: "We’ve verified the full refund. No items will be dispatched.",
  },
  cancelled: {
    heading: "This order was cancelled",
    details: "No items will be dispatched. Please don’t pay again while we reconcile the payment.",
  },
  "not-found": {
    heading: "Checkout not found",
    details: "Use the link you were given after checkout to check your order.",
  },
  unavailable: {
    heading: "We can’t check your payment right now",
    details: "Try checking again in a moment. You don’t need to pay again.",
  },
};

const accountCopy = {
  confirmed: {
    heading: "Order confirmed",
    details: "We’ve invoiced your trade account on Net 30 terms. You can find the invoice and payment status in your account.",
  },
  pending: {
    heading: "Confirming your invoice",
    details: "We’re checking whether your invoice has been issued. Please don’t place the order again.",
  },
  expired: {
    heading: "This account order was cancelled",
    details: "We don’t have an issued invoice for this checkout. Go back to checkout to check whether you can start again.",
  },
  "cancelled-issued": {
    heading: "This account order was cancelled",
    details: "Please don’t pay any invoice for this order. Check its status below, and don’t place the order again while we reconcile it.",
  },
  review: {
    heading: "Your account order is under review",
    details: "An invoice was issued after the order was cancelled. Please don’t pay the invoice or place the order again while we review it.",
  },
  "not-found": {
    heading: "Checkout not found",
    details: "Sign in to the account that placed the order to view its confirmation.",
  },
  unavailable: {
    heading: "We can’t check your invoice right now",
    details: "Try checking again in a moment. Please don’t place the order again.",
  },
};

const pollIntervalMs = 3000;
const maxAutomaticChecks = 10;

type CheckoutStatusProps = { kind: keyof typeof copy; method?: "card" }
  | { kind: keyof typeof accountCopy; method: "net30" };

export function CheckoutStatus({ kind, method }: CheckoutStatusProps) {
  const router = useRouter();
  const [automaticChecking, startAutomaticCheck] = useTransition();
  const [manualChecking, startManualCheck] = useTransition();
  const [checks, setChecks] = useState(0);
  const checking = automaticChecking || manualChecking;
  const canRetry = kind === "pending" || kind === "unavailable" || (method === "net30" && kind === "review");
  const automaticChecksEnded = kind === "pending" && checks >= maxAutomaticChecks && !checking;
  const net30 = method === "net30";
  const status = method === "net30" ? accountCopy[kind] : copy[kind];

  useEffect(() => {
    if (kind !== "pending" || checks >= maxAutomaticChecks || checking) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      window.clearInterval(timer);
      setChecks((count) => count + 1);
      startAutomaticCheck(() => router.refresh());
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [checking, checks, kind, router]);

  function checkAgain() {
    if (checking) return;
    setChecks(0);
    startManualCheck(() => router.refresh());
  }

  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h1>{status.heading}</h1>
        <p className={styles.message}>
          {manualChecking ? (net30 ? "Checking invoice status…" : "Checking payment status…") : automaticChecksEnded
            ? (net30 ? "This is taking longer than expected. You can check again below. Please don’t place the order again."
              : "This is taking longer than expected. You can check again below. You don’t need to pay again.")
            : status.details}
        </p>
      </div>
      {canRetry && (
        <button className={`textlink ${styles.retry}`} type="button" onClick={checkAgain} aria-disabled={checking}>
          {net30 ? "Check invoice status" : "Check payment status"}
        </button>
      )}
    </>
  );
}
