import { getVerifiedBuyer } from "@/lib/auth/server";
import { startCheckoutAttempt } from "@/lib/checkout/server";
import type { CheckoutReviewResult } from "@/lib/checkout/types";
import { isRecord, normaliseAttemptToken, normaliseLines, validateCheckoutFields } from "@/lib/checkout/validation";
import { readRequestBody } from "@/lib/payments/body";
import { checkoutOrigin, PaymentConfigurationError } from "@/lib/payments/config";
import { net30Attempt, reserveNet30Order, submitNet30Invoice } from "@/lib/payments/net30";
import { checkoutRateKeys, checkoutRateLimitMessage, isCheckoutRateLimit, limitCheckout } from "@/lib/payments/rate-limit";
import { getOrderItems, paymentStore, type Order } from "@/lib/payments/store";
import { getStripe } from "@/lib/payments/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReviewFailure = Exclude<CheckoutReviewResult, { status: "payment-unavailable" }>;
export type Net30CheckoutResult = ReviewFailure | { status: "authorised" | "confirming"; orderId: string }
  | { status: "trade-unavailable"; reason: "not-approved" | "suspended" | "over-limit" | "unavailable" }
  | { status: "error"; message: string; attemptClosed?: true; attemptPending?: true }
  | { status: "invalid"; errors: { poReference: string }; message: string };

function reply(result: Net30CheckoutResult, status: number) {
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

function closed() {
  return reply({ status: "error", attemptClosed: true, message: "This account checkout is closed. Review your basket and try again." }, 409);
}

function pending() {
  return reply({ status: "error", attemptPending: true, message: "We couldn’t verify the account checkout yet. Try again or close the attempt before using card payment." }, 409);
}

async function retireMissing(token: string) {
  const { data, error } = await paymentStore().rpc("close_missing_checkout_attempt", { p_attempt_token: token });
  if (error) throw error;
  return data;
}

async function complete(order: Order, close = false) {
  const current = order.provider_invoice_id && order.fulfilment_status !== "awaiting_authorisation"
    ? order : await submitNet30Invoice(order, close);
  if (current.fulfilment_status === "cancelled" &&
    (!current.provider_invoice_id || current.payment_status === "voided" || current.payment_status === "refunded")) return closed();
  return current.provider_invoice_id && current.authorised_at
    ? reply({ status: "authorised", orderId: current.id }, 200)
    : reply({ status: "confirming", orderId: current.id }, 202);
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return reply({ status: "error", message: "Send the checkout details as JSON." }, 415);
  }
  let body: unknown;
  try {
    body = JSON.parse((await readRequestBody(request, 32 * 1_024)).toString());
  } catch (error) {
    return reply({ status: "error", message: "This checkout request is invalid." }, error instanceof RangeError ? 413 : 400);
  }
  const token = isRecord(body) && normaliseAttemptToken(body.attemptToken);
  if (!isRecord(body) || !token) return reply({ status: "error", message: "This account checkout attempt is invalid." }, 400);
  const recovering = body.action === "resume" || body.action === "close";
  try {
    const origin = checkoutOrigin();
    const sender = request.headers.get("origin");
    if (sender !== origin && (sender !== null || request.headers.get("sec-fetch-site") !== "same-origin")) {
      return reply({ status: "error", message: "Start payment from the Edgey checkout." }, 403);
    }
    const buyer = await getVerifiedBuyer();
    if (!buyer) return recovering ? pending() : reply({ status: "trade-unavailable", reason: "not-approved" }, 403);
    let order = await net30Attempt(token, buyer.id);
    const decline = async (result: Net30CheckoutResult, status: number) =>
      !order && await retireMissing(token) ? reply(result, status) : pending();
    if (recovering) {
      if (order) return await complete(order, body.action === "close");
      if (body.action !== "close") return pending();
      await limitCheckout(request, origin, "checkout_close", buyer.email);
      if (await retireMissing(token)) return closed();
      order = await net30Attempt(token, buyer.id);
      return order ? await complete(order, true) : pending();
    }

    const lines = normaliseLines(body.lines);
    if (!lines?.length || typeof body.quoteKey !== "string" || body.quoteKey.length > 64) {
      return reply({ status: "error", message: "This account checkout attempt is invalid." }, 400);
    }
    const po = typeof body.poReference === "string" ? body.poReference.trim() : "";
    if (!po || po.length > 200 || /[\p{Cc}\p{Cf}]/u.test(po)) {
      const message = "Enter a purchase order number of up to 200 characters.";
      return await decline({ status: "invalid", errors: { poReference: message }, message }, 422);
    }
    const validated = validateCheckoutFields(body.fields);
    if (!validated.ok) return await decline({ status: "invalid", errors: validated.errors, message: "Check the highlighted details." }, 422);
    if (order) {
      const items = await getOrderItems(order.id);
      const fields = validated.fields;
      if (order.po_number !== po || order.email !== fields.email || order.business_name !== fields.businessName ||
        order.recipient_name !== fields.recipientName || order.address_line1 !== fields.line1 ||
        order.address_line2 !== (fields.line2 || null) || order.address_town !== fields.town ||
        order.address_region !== (fields.region || null) || order.address_postcode !== fields.postcode ||
        items.length !== lines.length || lines.some((line) => !items.some((item) =>
          item.variant_id === line.variantId && item.quantity === line.quantity))) {
        return pending();
      }
      return await complete(order);
    }
    const { data: account, error } = await paymentStore().from("trade_accounts")
      .select("status").eq("buyer_id", buyer.id).maybeSingle();
    if (error) throw error;
    if (account?.status === "suspended") return await decline({ status: "trade-unavailable", reason: "suspended" }, 403);
    if (account?.status !== "approved") return await decline({ status: "trade-unavailable", reason: "not-approved" }, 403);
    if (process.env.NET30_CHECKOUT_ENABLED !== "true") return await decline({ status: "trade-unavailable", reason: "unavailable" }, 503);
    await limitCheckout(request, origin, "checkout_review", buyer.email);
    const ready = await startCheckoutAttempt(body);
    if (ready.status !== "ready") return await decline(ready, ready.status === "review" ? 409 : 422);
    if (ready.buyerId !== buyer.id) return pending();
    if (ready.orderInput.totals.grossPence < 30 || ready.orderInput.totals.grossPence > 99_999_999 ||
      ready.orderInput.lines.length + Number(ready.orderInput.totals.deliveryNetPence > 0) > 100) {
      return await decline({ status: "trade-unavailable", reason: "unavailable" }, 422);
    }
    try {
      getStripe();
    } catch (error) {
      if (!(error instanceof PaymentConfigurationError)) throw error;
      return await decline({ status: "trade-unavailable", reason: "unavailable" }, 503);
    }
    try {
      order = await reserveNet30Order({ ...ready.orderInput, poNumber: po }, checkoutRateKeys(request, origin, buyer.email));
    } catch (error) {
      const code = (error as { message?: string })?.message;
      if (code === "checkout_attempt_closed") return closed();
      if (code === "insufficient_trade_credit") return await decline({ status: "trade-unavailable", reason: "over-limit" }, 409);
      if (code === "approved_trade_account_required") {
        const { data } = await paymentStore().from("trade_accounts").select("status").eq("buyer_id", buyer.id).maybeSingle();
        return await decline({ status: "trade-unavailable", reason: data?.status === "suspended" ? "suspended" : "not-approved" }, 403);
      }
      if (["insufficient_stock", "variant_not_published", "stale_unit_price", "delivery_terms_changed"].includes(code ?? "")) {
        const fresh = await startCheckoutAttempt(body);
        if (fresh.status === "review") return await decline(fresh, 409);
        if (code === "delivery_terms_changed" && fresh.status !== "ready") return await decline(fresh, 422);
      }
      throw error;
    }
    return await complete(order);
  } catch (error) {
    if (isCheckoutRateLimit(error)) {
      return reply({ status: "error", attemptPending: true, message: checkoutRateLimitMessage }, 429);
    }
    return pending();
  }
}
