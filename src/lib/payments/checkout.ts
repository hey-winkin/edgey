import "server-only";
import { attributeFinderCheckout } from "@/lib/commercial/checkout";
import type Stripe from "stripe";
import { createOrderWithReservations, type CreateOrderInput } from "@/lib/orders";
import type { ReservationRateKeys } from "@/lib/orders/reservation-input";
import type { Json } from "@/lib/supabase/database.types";
import { checkoutOrigin } from "./config";
import { bindVerifiedSession, closeUnboundCheckout, findStripeSession, stripeAccountId, stripeRequestKey } from "./recovery";
import { assertSessionMatches, sessionAmountMatches } from "./session-identity";
import { stripeSessionParams } from "./session-params";
import { reconcileSession } from "./settle";
import { getOrderItems, paymentStore, type Order } from "./store";
import { getStripe } from "./stripe";

type CardAttemptIdentity = { attemptToken: string; buyerId: string | null };
type CardAttempt = CardAttemptIdentity & Pick<CreateOrderInput, "contact" | "address"> & {
  lines: readonly { variantId: string; quantity: number }[];
};
type PriceAttempt = () => Promise<Omit<CreateOrderInput, "attemptToken" | "holdExpiresAt" | "buyerId">>;

export class CheckoutUnavailableError extends Error {
  constructor(message: string, readonly attemptClosed = false) { super(message); }
}

export class CheckoutOwnerMismatchError extends Error {
  constructor() {
    super("This payment attempt was started under a different sign-in. Return to the original sign-in state to resume or close it.");
  }
}

async function findCardAttempt({ attemptToken, buyerId }: CardAttemptIdentity) {
  const { data, error } = await paymentStore().from("orders").select("*")
    .eq("checkout_attempt_token", attemptToken).maybeSingle();
  if (error) throw error;
  if (data && data.buyer_id !== buyerId) throw new CheckoutOwnerMismatchError();
  if (data && data.payment_method !== "card") {
    throw new CheckoutUnavailableError("This attempt can’t be used for card payment.");
  }
  return data;
}

export async function beginCardPayment(attempt: CardAttempt, priceAttempt: PriceAttempt, rateKeys: () => ReservationRateKeys) {
  const existing = () => findCardAttempt(attempt);
  const holdExpiresAt = new Date((Math.floor(Date.now() / 1_000) + 35 * 60) * 1_000).toISOString();
  let order = await existing();
  if (!order) {
    try {
      const priced = await priceAttempt();
      if (priced.totals.grossPence < 30 || priced.totals.grossPence > 99_999_999 ||
        priced.lines.length + Number(priced.totals.deliveryNetPence > 0) > 100) {
        throw new CheckoutUnavailableError("This order is outside the limits for online card payment.");
      }
      getStripe();
      await createOrderWithReservations({
        ...priced, attemptToken: attempt.attemptToken, holdExpiresAt, buyerId: attempt.buyerId ?? undefined,
      }, rateKeys());
    } catch (error) {
      order = await existing();
      if (!order) throw error;
    }
  }
  order ??= await existing();
  if (!order) throw new Error("Could not load the reserved order.");

  const items = await getOrderItems(order.id);
  if (!matchesAttempt(order, attempt, items)) {
    throw new CheckoutUnavailableError("This payment attempt cannot be used for a changed order.");
  }
  await attributeFinderCheckout(order.id, attempt.attemptToken, attempt.buyerId);
  return openReservedPayment(order, items);
}

export async function resumeCardPayment(attempt: CardAttemptIdentity) {
  const order = await findCardAttempt(attempt);
  return order ? openReservedPayment(order, await getOrderItems(order.id)) : null;
}

export async function closeCardPayment(attempt: CardAttemptIdentity, beforeCloseMissing: () => Promise<void>) {
  let order = await findCardAttempt(attempt);
  if (!order) {
    await beforeCloseMissing();
    const { data, error } = await paymentStore().rpc("close_missing_checkout_attempt", { p_attempt_token: attempt.attemptToken });
    if (error) throw error;
    if (data) return null;
    order = await findCardAttempt(attempt);
    if (!order) throw new CheckoutUnavailableError("We can’t verify the previous checkout.");
  }
  if (order.fulfilment_status === "cancelled" && !order.paid_pence && !order.payment_review_reason) return null;
  const stripe = getStripe();
  if (!order.checkout_session_id && !order.stripe_checkout_started_at) {
    order = await closeUnboundCheckout(order, undefined, true);
    if (order.fulfilment_status === "cancelled" && !order.paid_pence) return null;
  }
  let session = await findStripeSession(stripe, order);
  if (!session && order.stripe_checkout_started_at) {
    order = await closeUnboundCheckout(order, await stripeAccountId(stripe));
    if (order.fulfilment_status === "cancelled" && !order.paid_pence) return null;
  }
  if (!session) throw new CheckoutUnavailableError("We can’t verify the previous payment yet. Try again before starting a new checkout.");
  assertSessionMatches(order, session);
  if (session.status === "open") {
    try {
      session = await stripe.checkout.sessions.expire(session.id);
    } catch {
      session = await stripe.checkout.sessions.retrieve(session.id);
    }
  }
  const updated = await reconcileSession(stripe, order, session);
  if (updated.authorised_at) return successPayment(checkoutOrigin(), session.id);
  if (updated.fulfilment_status === "cancelled" && !updated.paid_pence) return null;
  throw new CheckoutUnavailableError("We can’t verify that the previous payment closed unpaid. Try again before starting a new checkout.");
}

function successPayment(origin: string, sessionId: string) {
  return { sessionId, url: `${origin}/checkout/success?session_id=${sessionId}` };
}

async function openReservedPayment(order: Order, items: Awaited<ReturnType<typeof getOrderItems>>) {
  if (order.payment_review_reason || order.fulfilment_status === "cancelled") {
    throw new CheckoutUnavailableError("This payment attempt is closed or under review.",
      order.fulfilment_status === "cancelled" && !order.payment_review_reason && order.paid_pence === 0);
  }
  const stripe = getStripe();
  const origin = checkoutOrigin();
  const db = paymentStore();

  let session: Stripe.Checkout.Session | null;
  if (order.checkout_session_id) {
    session = await stripe.checkout.sessions.retrieve(order.checkout_session_id);
  } else {
    if (!order.stripe_checkout_request) {
      const request = stripeSessionParams(order, items, origin);
      const { data, error } = await db.rpc("prepare_stripe_checkout", {
        p_order_id: order.id,
        p_request: JSON.parse(JSON.stringify(request)) as Json,
        p_account_id: await stripeAccountId(stripe),
      });
      if (error) throw error;
      order = data;
    }
    if (order.checkout_session_id) {
      session = await stripe.checkout.sessions.retrieve(order.checkout_session_id);
    } else if (order.stripe_checkout_request && order.fulfilment_status === "awaiting_authorisation" &&
      !order.payment_review_reason) {
      session = await findStripeSession(stripe, order);
      if (!session && Date.parse(order.hold_expires_at) - Date.now() > 30 * 60_000 + 15_000) {
        try {
          session = await stripe.checkout.sessions.create(
            order.stripe_checkout_request as Stripe.Checkout.SessionCreateParams,
            { idempotencyKey: stripeRequestKey(order.id) },
          );
        } catch (error) {
          session = await findStripeSession(stripe, order);
          if (!session) throw error;
        }
      }
      if (session) await bindVerifiedSession(order, session);
    } else {
      session = null;
    }
  }

  if (!session && !order.stripe_checkout_started_at && !order.checkout_session_id) {
    const closed = await closeUnboundCheckout(order, undefined, true);
    if (closed.fulfilment_status === "cancelled" && !closed.paid_pence) {
      throw new CheckoutUnavailableError("This payment attempt has closed. Review your basket and try again.", true);
    }
  }
  if (!session) throw new CheckoutUnavailableError("Payment could not be resumed. Please try again shortly.");
  assertSessionMatches(order, session);
  if (session.status === "complete") {
    return successPayment(origin, session.id);
  }
  if (session.status !== "open" || !session.url || session.payment_status !== "unpaid") {
    throw new CheckoutUnavailableError("This payment attempt is no longer open.");
  }
  const url = new URL(session.url);
  if (url.origin !== "https://checkout.stripe.com") throw new Error("Unexpected Stripe Checkout origin.");
  if (!sessionAmountMatches(order, session)) {
    const { error } = await db.from("orders")
      .update({ stripe_reconciliation_error: "Open Stripe Checkout amount or currency does not match the order." })
      .eq("id", order.id).eq("fulfilment_status", "awaiting_authorisation");
    if (error) throw error;
    throw new CheckoutUnavailableError("The payment amount could not be verified. This attempt needs review.");
  }
  return { sessionId: session.id, url: session.url };
}

function matchesAttempt(order: Order, { contact, address, lines }: CardAttempt, items: Awaited<ReturnType<typeof getOrderItems>>) {
  return order.email === contact.email && order.business_name === contact.businessName &&
    order.recipient_name === contact.recipientName && order.phone === (contact.phone ?? null) &&
    order.address_line1 === address.line1 && order.address_line2 === (address.line2 ?? null) &&
    order.address_town === address.town && order.address_region === (address.region ?? null) &&
    order.address_postcode === address.postcode && order.address_country === address.country &&
    items.length === lines.length && lines.every((line) =>
      items.some((item) => item.variant_id === line.variantId && item.quantity === line.quantity));
}
