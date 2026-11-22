import { promiseUnderTerms, type DeliveryTerms } from "@/lib/delivery/terms";
import type { CreateOrderInput } from "@/lib/orders";
import { quoteSelectionAndTermsWith, type QuoteDependencies } from "./quote";
import type { CheckoutReviewResult, QuoteResult } from "./types";
import { isRecord, normaliseAttemptToken, validateCheckoutFields } from "./validation";

type OpenQuote = Extract<QuoteResult, { status: "ok" }>;
type ValidFields = Extract<ReturnType<typeof validateCheckoutFields>, { ok: true }>["fields"];
type PricedQuote = OpenQuote & {
  basket: NonNullable<OpenQuote["basket"]>;
  dispatchDate: string;
  estimatedDeliveryDate: string;
};

function snapshot(
  attemptToken: string, fields: ValidFields, quote: PricedQuote, holdExpiresAt: string, deliveryTerms: DeliveryTerms,
): CreateOrderInput {
  const { basket, dispatchDate, estimatedDeliveryDate } = quote;
  return {
    attemptToken,
    lines: basket.lines.map(({ variantId, quantity, unitNetPence }) => ({ variantId, quantity, unitPricePence: unitNetPence })),
    contact: {
      email: fields.email,
      businessName: fields.businessName,
      recipientName: fields.recipientName,
      buyingForWork: fields.buyingForWork,
    },
    address: {
      line1: fields.line1,
      line2: fields.line2 || undefined,
      town: fields.town,
      region: fields.region || undefined,
      postcode: fields.postcode,
      country: "GB" as const,
    },
    totals: {
      goodsNetPence: basket.goodsNetPence,
      deliveryNetPence: basket.delivery.netPence,
      vatRateBps: basket.vatRateBasisPoints,
      vatPence: basket.totalVatPence,
      grossPence: basket.totalGrossPence,
    },
    holdExpiresAt,
    deliveryService: basket.delivery.quote.serviceName,
    deliveryTerms,
    promise: { dispatchDate, deliveryDate: estimatedDeliveryDate },
  };
}

type AttemptResult = Exclude<CheckoutReviewResult, { status: "payment-unavailable" }> |
  { status: "ready"; orderInput: CreateOrderInput; quote: OpenQuote };

export async function prepareCheckoutAttempt(input: unknown, deps: QuoteDependencies): Promise<AttemptResult> {
  const attemptToken = isRecord(input) ? normaliseAttemptToken(input.attemptToken) : null;
  if (!isRecord(input) || !attemptToken || typeof input.quoteKey !== "string" || input.quoteKey.length > 64) {
    return { status: "error", message: "This checkout attempt is invalid. Refresh the page and try again." };
  }

  const validation = validateCheckoutFields(input.fields);
  if (!validation.ok) {
    return { status: "invalid", errors: validation.errors, message: "Check the fields with error messages before continuing." };
  }

  const { fields } = validation;
  const result = await quoteSelectionAndTermsWith(input.lines, fields.postcode, deps);
  if (!("quote" in result)) return result;
  const { quote, terms } = result;
  if (quote.corrections.length > 0) {
    return { status: "review", quote, message: "Stock has changed. Review your updated basket before continuing." };
  }
  if (!quote.basket) return { status: "error", message: "Add an item to your basket before continuing." };
  if (quote.coverage !== "covered" || !terms) {
    const message = "We can’t confirm delivery to this postcode. Ask us about delivery before ordering.";
    return { status: "invalid", errors: { postcode: message }, message };
  }
  if (quote.quoteKey !== input.quoteKey) {
    return { status: "review", quote, message: "Your quote has changed. Review the current prices and dates before continuing." };
  }
  const { basket, dispatchDate, estimatedDeliveryDate } = quote;
  const now = deps.now().getTime();
  const holdExpiresAt = Number.isFinite(now) ? new Date((Math.floor(now / 1000) + 35 * 60) * 1000).toISOString() : null;
  if (!dispatchDate || !estimatedDeliveryDate || !holdExpiresAt || !promiseUnderTerms(holdExpiresAt, terms).ok) {
    return { status: "error", message: "We can’t estimate dispatch and delivery right now. Ask us before ordering." };
  }

  return {
    status: "ready",
    orderInput: snapshot(attemptToken, fields, { ...quote, basket, dispatchDate, estimatedDeliveryDate }, holdExpiresAt, terms),
    quote,
  };
}
