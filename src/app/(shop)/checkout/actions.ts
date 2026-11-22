"use server";

import { quoteCurrentSelection, withSelectionProductNames } from "@/lib/checkout/server";
import type { QuoteResult } from "@/lib/checkout/types";
import { normaliseLines } from "@/lib/checkout/validation";
import { allowSelectionQuote } from "@/lib/requests/rate-limit";

export async function quoteSelection(lines: unknown, postcode?: unknown, includeProductNames?: boolean): Promise<QuoteResult> {
  const selection = normaliseLines(lines);
  if (!selection) return { status: "error", message: "Check your quantities and keep your basket to 100 lines or fewer." };
  if (selection.length) {
    try {
      if (!await allowSelectionQuote()) {
        return { status: "error", message: "Too many price and availability checks. Try again later." };
      }
    } catch {
      return { status: "error", message: "We couldn’t check the latest prices and availability. Try again." };
    }
  }
  const quote = await quoteCurrentSelection(selection, postcode);
  return includeProductNames === true ? withSelectionProductNames(quote) : quote;
}
