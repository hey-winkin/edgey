import "server-only";

import { getBuyerSession } from "@/lib/auth/server";
import { publicClient } from "@/lib/catalogue/supabase";
import { readWarehouseSchedule, resolveCheckoutDelivery } from "@/lib/delivery/server";
import { serviceClient } from "@/lib/supabase/service";
import { prepareCheckoutAttempt } from "./attempt";
import { quoteSelectionWith, type QuoteDependencies } from "./quote";
import type { QuoteResult } from "./types";

export const lookupSelectionVariants: QuoteDependencies["lookup"] = async (lines) => {
  const { data, error } = await serviceClient().rpc("lookup_selection_quote", {
    p_variant_ids: lines.map(({ variantId }) => variantId),
    p_quantities: lines.map(({ quantity }) => quantity),
  });
  if (error || !data) {
    const code = error?.code;
    console.error("Checkout variant lookup failed", code && /^[A-Z0-9]{5,10}$/.test(code) ? code : "unknown");
    throw new Error("Checkout variant lookup failed.");
  }

  return data.map((row) => ({
    id: row.id,
    sku: row.sku,
    optionLabel: row.option_label,
    tierPrices: {
      oneToFour: row.price_1_4_pence,
      fiveToNine: row.price_5_9_pence,
      tenPlus: row.price_10_plus_pence,
    },
    availableQuantity: row.quote_limit,
    photo: row.photo,
  }));
};

const deps: QuoteDependencies = { lookup: lookupSelectionVariants, now: () => new Date(), resolveDelivery: resolveCheckoutDelivery, readWarehouseSchedule };

export function quoteCurrentSelection(lines: unknown, postcode?: unknown) {
  return quoteSelectionWith(lines, postcode, deps);
}

export async function withSelectionProductNames(quote: QuoteResult): Promise<QuoteResult> {
  if (quote.status !== "ok" || !quote.lines.length) return quote;

  try {
    const { data, error } = await publicClient().from("variants")
      .select("id, products!inner(name)")
      .eq("publication_status", "published")
      .in("id", quote.lines.map(({ variantId }) => variantId))
      .abortSignal(AbortSignal.timeout(1_000))
      .overrideTypes<{ id: string; products: { name: string } }[], { merge: false }>();
    if (error) {
      console.warn("Checkout product names could not be loaded.");
      return quote;
    }
    if (!data?.length) return quote;
    return { ...quote, productNames: Object.fromEntries(data.map(({ id, products }) => [id, products.name])) };
  } catch {
    console.warn("Checkout product names could not be loaded.");
    return quote;
  }
}

export function priceCheckoutAttempt(input: unknown) {
  return prepareCheckoutAttempt(input, deps);
}

export async function getCheckoutActor() {
  const session = await getBuyerSession();
  if (session.status === "unverified") {
    return { status: "error" as const, message: "We couldn’t verify your sign-in. Sign in again or reload checkout before continuing." };
  }
  return { status: "ready" as const, buyerId: session.status === "verified" ? session.buyer.id : undefined };
}

export async function startCheckoutAttempt(input: unknown) {
  const attempt = await priceCheckoutAttempt(input);
  if (attempt.status !== "ready") return attempt;
  const actor = await getCheckoutActor();
  return actor.status === "ready" ? { ...attempt, buyerId: actor.buyerId } : actor;
}
