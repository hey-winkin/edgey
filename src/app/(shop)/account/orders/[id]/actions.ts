"use server";

import { compareReorder, type ReorderReview } from "@/lib/account/reorder";
import { getBuyerOrder } from "@/lib/account/server";
import { quoteCurrentSelection } from "@/lib/checkout/server";

export async function reviewReorder(orderId: string): Promise<ReorderReview> {
  try {
    const order = await getBuyerOrder(orderId);
    if (!order) return { status: "error", message: "This order isn’t available. Sign in to view your orders." };
    const quote = await quoteCurrentSelection(order.order_items.map(({ variant_id, quantity }) =>
      ({ variantId: variant_id, quantity }),
    ));
    if (quote.status === "error") return quote;
    return { status: "ok", review: compareReorder(order.order_items, quote) };
  } catch {
    return { status: "error", message: "We couldn’t check this reorder. Try again." };
  }
}
