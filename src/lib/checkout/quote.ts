import { createHash } from "node:crypto";
import { resolveQuotePhoto } from "@/lib/catalogue/media";
import {
  calculateBasket,
  calculateDispatchPromise,
  formatGbp,
  STANDARD_DELIVERY_QUOTE,
  type BasketTotals,
  type CommerceVariant,
  type DeliveryQuote,
  type LineRequest,
} from "@/lib/commerce";
import { promiseUnderTerms, type DeliveryResolution, type DeliveryTerms, type WarehouseSchedule } from "@/lib/delivery/terms";
import type { QuoteResult } from "./types";
import { MAX_ORDER_INTEGER, normaliseLines, readPostcodeInput } from "./validation";

const quoteUnavailable = "We couldn’t check the latest prices and availability. Try again.";

type CheckoutVariant = CommerceVariant & { photo?: unknown };

export type QuoteDependencies = {
  lookup: (lines: readonly LineRequest[]) => Promise<readonly CheckoutVariant[]>;
  now: () => Date;
  resolveDelivery: (postcode: string) => Promise<DeliveryResolution>;
  readWarehouseSchedule: () => Promise<WarehouseSchedule | null>;
};

export async function quoteSelectionWith(
  input: unknown,
  postcodeInput: unknown,
  deps: QuoteDependencies,
): Promise<QuoteResult> {
  const result = await quoteSelectionAndTermsWith(input, postcodeInput, deps);
  return "quote" in result ? result.quote : result;
}

export async function quoteSelectionAndTermsWith(
  input: unknown,
  postcodeInput: unknown,
  { lookup, now, resolveDelivery, readWarehouseSchedule }: QuoteDependencies,
): Promise<Extract<QuoteResult, { status: "error" }> |
  { quote: Extract<QuoteResult, { status: "ok" }>; terms: DeliveryTerms | null }> {
  const requested = normaliseLines(input);
  if (!requested) return { status: "error", message: "Check that your basket contains valid items and whole quantities." };

  let coverage: Extract<QuoteResult, { status: "ok" }>["coverage"] = "unchecked";
  let postcode: string | undefined;
  let deliveryQuote: DeliveryQuote = STANDARD_DELIVERY_QUOTE;
  let terms: DeliveryTerms | null = null;
  const postcodeText = readPostcodeInput(postcodeInput);
  if (postcodeInput !== undefined && postcodeText !== "") {
    const result = await resolveDelivery(postcodeText ?? "");
    if (!result.ok) {
      if (result.error.code !== "invalid_postcode") return { status: "error", message: quoteUnavailable };
      coverage = "invalid";
    } else {
      postcode = result.value.postcode.normalised;
      terms = result.value.terms;
      coverage = terms ? "covered" : "unsupported";
      if (terms) deliveryQuote = terms.quote;
    }
  }

  const ids = requested.map(({ variantId }) => variantId);
  const requestedIds = new Set(ids);
  const variants = new Map<string, CheckoutVariant>();
  if (ids.length) {
    try {
      for (const row of await lookup(requested)) {
        if (!requestedIds.has(row.id) || variants.has(row.id) ||
            !Number.isSafeInteger(row.availableQuantity) || row.availableQuantity < 0) {
          return { status: "error", message: quoteUnavailable };
        }
        variants.set(row.id, row);
      }
    } catch {
      return { status: "error", message: quoteUnavailable };
    }
  }

  const lines: LineRequest[] = [];
  const corrections: string[] = [];
  const photos: Record<string, string> = {};
  for (const line of requested) {
    const variant = variants.get(line.variantId);
    if (!variant) {
      corrections.push("An unavailable item was removed from your basket.");
      continue;
    }

    const quantity = Math.min(line.quantity, variant.availableQuantity);
    if (quantity === 0) {
      corrections.push(`${variant.sku} is out of stock and was removed from your basket.`);
      continue;
    }
    if (quantity < line.quantity) {
      corrections.push(`${variant.sku}: limited stock. We’ve suggested a smaller quantity for you to review.`);
    }
    lines.push({ variantId: line.variantId, quantity });
    const photo = resolveQuotePhoto(variant.sku, variant.photo);
    if (photo) photos[line.variantId] = photo;
  }

  let basket: BasketTotals | null = null;
  let freeDeliveryMessage: string | null = null;
  let dispatchDate: string | null = null;
  let estimatedDeliveryDate: string | null = null;
  if (lines.length) {
    const calculated = calculateBasket({ lines, deliveryQuote, variants: [...variants.values()] });
    if (!calculated.ok) return { status: "error", message: quoteUnavailable };
    basket = calculated.value;
    if (basket.totalGrossPence > MAX_ORDER_INTEGER) {
      return { status: "error", message: "Your basket exceeds the checkout limit. Reduce the quantities and try again." };
    }

    const progress = basket.delivery.freeDeliveryProgress;
    if ((coverage === "covered" || coverage === "unchecked") && progress) {
      freeDeliveryMessage = progress.remainingPence > 0
        ? `${formatGbp(progress.remainingPence)} more ex VAT for free delivery`
        : "Your basket qualifies for free delivery.";
    }

    const instant = now();
    if (Number.isFinite(instant.getTime())) {
      const authorisedAt = instant.toISOString();
      const promise = terms && promiseUnderTerms(authorisedAt, terms);
      if (promise?.ok) {
        ({ dispatchDate, estimatedDeliveryDate } = promise.value);
      } else if (!promise || (promise.error.code === "calendar_out_of_range" && promise.error.calendar === "delivery")) {
        const schedule = terms ?? await readWarehouseSchedule();
        if (schedule) {
          const { warehouseCalendar, cutoffMinutes } = schedule;
          const dispatchOnly = calculateDispatchPromise({ authorisedAt, warehouseCalendar, cutoffMinutes });
          if (dispatchOnly.ok) dispatchDate = dispatchOnly.value.dispatchDate;
        }
      }
    }
  }

  const quoteKey = createHash("sha256").update(JSON.stringify({
    version: 2,
    basket: basket && { ...basket, lines: [...basket.lines].sort((a, b) => a.variantId.localeCompare(b.variantId)) },
    coverage, postcode, dispatchDate, estimatedDeliveryDate, terms,
  })).digest("hex");

  return { terms, quote: {
    status: "ok", lines, corrections, basket, freeDeliveryMessage, dispatchDate, estimatedDeliveryDate, coverage,
    ...(postcode && { postcode }),
    ...(Object.keys(photos).length > 0 && { photos }),
    quoteKey,
  } };
}
