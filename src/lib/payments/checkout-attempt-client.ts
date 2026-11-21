import { withCheckoutAttemptLock } from "@/app/(shop)/checkout/attempt-lock";

export const activePaymentKey = "edgey-active-payment-v1";

export type ActivePayment = { token: string; sessionId?: string; previousToken?: string };

function read(storage: "localStorage" | "sessionStorage"): ActivePayment | null {
  try {
    const value = JSON.parse(window[storage].getItem(activePaymentKey) ?? "null");
    return value && typeof value.token === "string" &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.token) ? value : null;
  } catch {
    return null;
  }
}

export function readActivePayment() {
  return read("localStorage") ?? read("sessionStorage");
}

export function storeActivePayment(value: ActivePayment | null) {
  try {
    if (value) localStorage.setItem(activePaymentKey, JSON.stringify(value));
    else localStorage.removeItem(activePaymentKey);
  } catch {
    try {
      if (value) sessionStorage.setItem(activePaymentKey, JSON.stringify(value));
      else sessionStorage.removeItem(activePaymentKey);
    } catch { return false; }
    return true;
  }
  try { sessionStorage.removeItem(activePaymentKey); } catch {}
  return true;
}

export function sameActivePayment(a: ActivePayment | null, b: ActivePayment | null) {
  return a?.token === b?.token && a?.previousToken === b?.previousToken && a?.sessionId === b?.sessionId;
}

export async function clearConfirmedActivePayment(scope: string) {
  try {
    const active = readActivePayment();
    if (!active?.sessionId) return;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(active.sessionId));
    const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (scope === hash) await withCheckoutAttemptLock(() => {
      if (sameActivePayment(readActivePayment(), active)) storeActivePayment(null);
    });
  } catch {}
}
