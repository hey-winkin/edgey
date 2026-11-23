import type { StaffPurchaseStatus } from "@/lib/supabase/database.types";

export const purchaseStatusLabel: Record<StaffPurchaseStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  part_received: "Part received",
  received: "Received",
  closed: "Closed",
  cancelled: "Cancelled",
};

export function canReceivePurchaseOrder(status: StaffPurchaseStatus) {
  return status === "sent" || status === "part_received";
}

export type PurchaseReceiptTarget = {
  id: string;
  number: string;
  revision: number;
  lines: { variantId: string; sku: string; bladeName: string; outstanding: number }[];
};

export type PurchaseVariance = {
  variantId: string;
  sku: string;
  kind: "short" | "over" | "unexpected";
  quantity: number;
};

export function purchaseVariances(
  order: PurchaseReceiptTarget, actual: { variantId: string; sku: string; quantity: number }[],
) {
  const planned = new Set(order.lines.map(({ variantId }) => variantId));
  const received = new Map(actual.map(({ variantId, quantity }) => [variantId, quantity]));
  return [
    ...order.lines.flatMap(({ variantId, sku, outstanding }): PurchaseVariance[] => {
      const difference = (received.get(variantId) ?? 0) - outstanding;
      return difference ? [{ variantId, sku, kind: difference < 0 ? "short" : "over", quantity: Math.abs(difference) }] : [];
    }),
    ...actual.flatMap(({ variantId, sku, quantity }): PurchaseVariance[] =>
      planned.has(variantId) ? [] : [{ variantId, sku, kind: "unexpected", quantity }],
    ),
  ];
}

export function formatPurchaseAmount(value: number | bigint, currency: string) {
  const units = BigInt(value);
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code" })
    .formatToParts(units / 100n)
    .map(({ type, value }) => type === "fraction" ? String(units % 100n).padStart(2, "0") : value).join("");
}
