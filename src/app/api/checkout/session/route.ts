import { getCheckoutActor, priceCheckoutAttempt } from "@/lib/checkout/server";
import type { CheckoutReviewResult } from "@/lib/checkout/types";
import { isRecord, normaliseAttemptToken, normaliseLines, validateCheckoutFields } from "@/lib/checkout/validation";
import { readRequestBody } from "@/lib/payments/body";
import { beginCardPayment, CheckoutOwnerMismatchError, CheckoutUnavailableError, closeCardPayment, resumeCardPayment } from "@/lib/payments/checkout";
import { checkoutOrigin, PaymentConfigurationError } from "@/lib/payments/config";
import { checkoutRateKeys, checkoutRateLimitMessage, isCheckoutRateLimit, limitCheckout } from "@/lib/payments/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReviewFailure = Exclude<CheckoutReviewResult, { status: "payment-unavailable" }>;
export type CheckoutSessionResult = ReviewFailure | { status: "payment"; sessionId: string; url: string }
  | { status: "error"; message: string; attemptClosed?: true; attemptPending?: true; attemptOwnerMismatch?: true }
  | { status: "closed" };

class NeedsCheckoutReview extends Error {
  constructor(readonly result: ReviewFailure) { super(result.message); }
}

function reply(result: CheckoutSessionResult, status: number) {
  return Response.json(result, { status, headers: { "Cache-Control": "no-store" } });
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
  const token = isRecord(body) ? normaliseAttemptToken(body.attemptToken) : null;
  if (!isRecord(body) || !token) return invalidAttempt();
  try {
    const origin = checkoutOrigin();
    const sender = request.headers.get("origin");
    if (sender && sender !== origin) {
      return reply({ status: "error", message: "Start payment from the Edgey checkout." }, 403);
    }
    const previous = normaliseAttemptToken(body.supersedesAttemptToken);
    if (body.supersedesAttemptToken !== undefined && (!previous || previous === token)) return invalidAttempt();
    const actor = await getCheckoutActor();
    if (actor.status === "ready" && actor.buyerId && sender === null &&
      request.headers.get("sec-fetch-site") !== "same-origin") {
      return reply({ status: "error", message: "Start payment from the Edgey checkout." }, 403);
    }
    const recovering = body.action === "resume" || body.action === "close";
    if (actor.status === "error" && !recovering) return reply(actor, 422);
    const buyerId = actor.status === "ready" ? actor.buyerId ?? null : null;
    const close = (attemptToken: string) => closeCardPayment(
      { attemptToken, buyerId }, async () => {
        if (actor.status === "error") throw new CheckoutOwnerMismatchError();
        await limitCheckout(request, origin, "checkout_close", attemptToken);
      },
    );
    if (recovering) {
      let payment;
      try {
        const recover = body.action === "resume" ? (attemptToken: string) => resumeCardPayment({ attemptToken, buyerId }) : close;
        payment = await recover(token);
        if (!payment && previous) payment = await recover(previous);
      } catch (error) {
        if (actor.status === "error" && error instanceof CheckoutOwnerMismatchError) {
          return reply({ ...actor, attemptPending: true }, 422);
        }
        throw error;
      }
      if (!payment && body.action === "resume" && actor.status === "error") {
        return reply({ ...actor, attemptPending: true }, 422);
      }
      if (!payment && body.action === "resume") return reply({
        status: "error", message: "We can’t find a payable session yet. Try again, or close this checkout to start over.", attemptPending: true,
      }, 409);
      return reply(payment ? { status: "payment", ...payment } : { status: "closed" }, 200);
    }
    const lines = normaliseLines(body.lines);
    if (!lines?.length || typeof body.quoteKey !== "string" || body.quoteKey.length > 64) return invalidAttempt();
    const validation = validateCheckoutFields(body.fields);
    if (!validation.ok) {
      return reply({ status: "invalid", errors: validation.errors, message: "Check the highlighted details before continuing." }, 422);
    }
    const { email, businessName, recipientName, buyingForWork, line1, line2, town, region, postcode } = validation.fields;
    if (previous) {
      const paid = await close(previous);
      if (paid) return reply({ status: "payment", ...paid }, 200);
    }
    const payment = await beginCardPayment({
      attemptToken: token,
      buyerId,
      lines,
      contact: { email, businessName, recipientName, buyingForWork },
      address: { line1, line2: line2 || undefined, town, region: region || undefined, postcode, country: "GB" },
    }, async () => {
      await limitCheckout(request, origin, "checkout_review", email);
      const result = await priceCheckoutAttempt(body);
      if (result.status !== "ready") throw new NeedsCheckoutReview(result);
      return result.orderInput;
    }, () => checkoutRateKeys(request, origin, email));
    return reply({ status: "payment", ...payment }, 200);
  } catch (error) {
    if (error instanceof NeedsCheckoutReview) {
      return reply(error.result, error.result.status === "review" ? 409 : 422);
    }
    if (error instanceof PaymentConfigurationError) {
      console.error("Card payment configuration is unavailable.");
      return reply({ status: "error", message: "Card payment is unavailable right now. Try again later." }, 503);
    }
    if (isCheckoutRateLimit(error)) return reply({ status: "error", message: checkoutRateLimitMessage }, 429);
    if (error instanceof CheckoutOwnerMismatchError) return reply({
      status: "error", message: error.message, attemptPending: true, attemptOwnerMismatch: true,
    }, 409);
    if (error instanceof CheckoutUnavailableError) return reply({
      status: "error", message: error.message,
      ...(error.attemptClosed ? { attemptClosed: true as const } : { attemptPending: true as const }),
    }, 409);
    const reason = (error as { message?: string })?.message;
    if (reason === "checkout_attempt_closed") {
      return reply({ status: "error", message: "This payment attempt has closed. Review your basket and try again.", attemptClosed: true }, 409);
    }
    if (["insufficient_stock", "variant_not_published", "stale_unit_price", "delivery_terms_changed"].includes(reason ?? "")) {
      const quote = await currentQuote(body).catch(() => ({ status: "error" as const, message: "We couldn’t get an updated quote. Try again." }));
      return reply({ status: "review", quote, message: "Your quote has changed. Review the basket before continuing." }, 409);
    }
    console.error("Stripe checkout could not verify provider or database state.");
    return reply({ status: "error", message: "We couldn’t open payment right now. Try again from this checkout.", attemptPending: true }, 502);
  }
}

function invalidAttempt() {
  return reply({ status: "error", message: "This checkout attempt is invalid. Review your basket and try again." }, 400);
}

async function currentQuote(body: Record<string, unknown>) {
  const result = await priceCheckoutAttempt(body);
  return result.status === "ready" || result.status === "review"
    ? result.quote
    : { status: "error" as const, message: result.message };
}
