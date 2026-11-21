import { normaliseAttemptToken } from "@/lib/checkout/validation";
import { readActivePayment } from "@/lib/payments/checkout-attempt-client";
import { withCheckoutAttemptLock } from "./attempt-lock";

export const net30AttemptKey = "edgey-active-net30-v1";

export type ActiveNet30 = { token: string; selectionNonce: string | null; orderId?: string };

export function readNet30Attempt(): ActiveNet30 | null {
  try {
    const value = JSON.parse(localStorage.getItem(net30AttemptKey) ?? "null");
    const token = normaliseAttemptToken(value?.token);
    if (!token) return null;
    return {
      token,
      selectionNonce: typeof value.selectionNonce === "string" ? value.selectionNonce : null,
      orderId: typeof value.orderId === "string" ? value.orderId : undefined,
    };
  } catch {
    return null;
  }
}

export async function startNet30Attempt(selectionNonce: string | null) {
  if (!navigator.locks) throw new Error("Net 30 requires cross-tab checkout locking.");
  return withCheckoutAttemptLock(() => {
    if (readNet30Attempt() || readActivePayment()) return null;
    const attempt: ActiveNet30 = { token: crypto.randomUUID(), selectionNonce };
    localStorage.setItem(net30AttemptKey, JSON.stringify(attempt));
    return attempt;
  });
}

export async function rememberNet30Order(token: string, orderId: string) {
  await withCheckoutAttemptLock(() => {
    const current = readNet30Attempt();
    if (current?.token === token) localStorage.setItem(net30AttemptKey, JSON.stringify({ ...current, orderId }));
  });
}

export async function clearNet30Attempt(match: { token: string } | { orderId: string }) {
  await withCheckoutAttemptLock(() => {
    const current = readNet30Attempt();
    if (!current) return;
    if ("token" in match ? current.token === match.token : current.orderId === match.orderId) {
      localStorage.removeItem(net30AttemptKey);
    }
  });
}

export const net30SelectionScope = (orderId: string) => `net30:${orderId.toLowerCase()}`;
