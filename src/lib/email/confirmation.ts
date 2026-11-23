import { formatGbp } from "@/lib/commerce/money";
import type { Database } from "@/lib/supabase/database.types";
import { isSingleMailbox } from "./address";

type Order = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "order_reference" | "email" | "recipient_name" | "goods_net_pence" | "delivery_net_pence"
  | "vat_rate_bps" | "vat_pence" | "gross_pence" | "delivery_service"
  | "promised_dispatch_date" | "estimated_delivery_date" | "payment_method" | "po_number"
>;
type OrderItem = Pick<
  Database["public"]["Tables"]["order_items"]["Row"],
  "sku" | "option_label" | "quantity" | "unit_price_pence" | "net_pence"
>;

const date = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeZone: "Europe/London",
});
const percent = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 2 });

const entities: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
};
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => entities[character]!);

export function hostedStripeInvoice(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "https://invoice.stripe.com" && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

export function renderConfirmation(
  order: Order, items: OrderItem[], from: string, hostedInvoice: string | null,
) {
  if (!isSingleMailbox(order.email) || !items.length) {
    throw new Error("Cannot render the order confirmation.");
  }

  const subject = `Edgey order confirmation: ${order.order_reference}`;
  const greeting = `Hello ${order.recipient_name},`;
  const intro = `Thank you for your order. Your order reference is ${order.order_reference}.`;
  const onAccount = order.payment_method === "net30";
  const totals = [
    ["Goods subtotal (ex VAT)", formatGbp(order.goods_net_pence)],
    ["Delivery (ex VAT)", formatGbp(order.delivery_net_pence)],
    [`VAT (${percent.format(order.vat_rate_bps / 10_000)})`, formatGbp(order.vat_pence)],
    [onAccount ? "Order total (inc VAT)" : "Total paid (inc VAT)", formatGbp(order.gross_pence)],
  ] as const;
  const delivery = [
    ["Delivery service", order.delivery_service],
    ["Promised dispatch", date.format(new Date(order.promised_dispatch_date))],
    ["Estimated delivery", date.format(new Date(order.estimated_delivery_date))],
  ] as const;
  const lines = items.map((item) => [
    item.sku, item.option_label, String(item.quantity),
    formatGbp(item.unit_price_pence), formatGbp(item.net_pence),
  ]);
  const details = [...totals, ...(onAccount ? [
    ["Payment terms", "Net 30 — sign in to your Edgey account to view the invoice, balance and due date"],
    ["Purchase order", order.po_number ?? ""],
  ] : []), ...delivery];
  const invoice = onAccount ? null : hostedStripeInvoice(hostedInvoice);
  const text = [
    greeting, "", intro, "",
    ...lines.map(([sku, label, quantity, unit, total]) => `${sku} — ${label}: ${quantity} × ${unit} = ${total} ex VAT`),
    "", ...details.map(([label, value]) => `${label}: ${value}`),
    ...(invoice ? ["", `View your VAT invoice: ${invoice}`] : []),
  ].join("\n");
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Edgey order confirmation</title></head><body>',
    "<h1>Order confirmation</h1>",
    `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p>`,
    '<table><thead><tr><th scope="col">SKU</th><th scope="col">Option</th><th scope="col">Quantity</th>',
    '<th scope="col">Unit price (ex VAT)</th><th scope="col">Line total (ex VAT)</th></tr></thead><tbody>',
    ...lines.map((line) => `<tr>${line.map((field) => `<td>${escapeHtml(field)}</td>`).join("")}</tr>`),
    "</tbody></table><dl>",
    ...details.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`),
    "</dl>",
    ...(invoice ? [`<p><a href="${escapeHtml(invoice)}">View your VAT invoice</a></p>`] : []),
    "</body></html>",
  ].join("");
  return { from, to: [order.email], subject, text, html };
}
