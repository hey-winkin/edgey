import type { Database } from "@/lib/supabase/database.types";
import { z } from "zod";
import { isSingleMailbox } from "./address";
import { escapeHtml } from "./confirmation";

type DeliveryAddress = Pick<Database["public"]["Tables"]["orders"]["Row"],
  "recipient_name" | "address_line1" | "address_line2" | "address_town"
  | "address_region" | "address_postcode" | "address_country">;

export const dispatchLines = z.array(z.object({
  sku: z.string(), option_label: z.string().nullable(), quantity: z.number().int().positive(),
})).nonempty();
type DispatchLine = z.infer<typeof dispatchLines>[number];

export function trackingUrl(pattern: string | null | undefined, tracking: string) {
  const token = "{tracking}";
  if (!pattern || tracking === "." || tracking === ".."
    || !/^https:\/\/[^/?#]+[/?#]/.test(pattern) || /[\s\\\p{Cc}]/u.test(pattern)
    || pattern.split(token).length !== 2
    || pattern.slice(8).split(/[/?#]/, 1)[0]?.includes(token)) return null;
  try {
    const template = new URL(pattern.replace(token, "EDGEYTRACKING"));
    const url = new URL(pattern.replace(token, encodeURIComponent(tracking)));
    return !url.username && !url.password && url.origin === template.origin ? url.href : null;
  } catch {
    return null;
  }
}

export function renderDispatch(shipment: DeliveryAddress & {
  email: string; service: string; carrier: string; tracking: string;
  reference: string; kind: "order" | "trial";
}, items: DispatchLine[], from: string, pattern?: string | null) {
  if (!isSingleMailbox(shipment.email) || !items.length) {
    throw new Error("Cannot render the dispatch email.");
  }

  const trial = shipment.kind === "trial";
  const title = trial ? "Trial pack dispatched" : "Order dispatched";
  const label = trial ? "Trial reference" : "Order reference";
  const subject = `Edgey ${title.toLowerCase()}: ${shipment.reference}`;
  const greeting = `Hello ${shipment.recipient_name},`;
  const intro = trial ? "Your Edgey trial pack has been dispatched." : "Your Edgey order has been dispatched.";
  const address = [
    shipment.recipient_name, shipment.address_line1, shipment.address_line2, shipment.address_town,
    shipment.address_region, shipment.address_postcode, shipment.address_country,
  ].filter((part): part is string => Boolean(part));
  const details = [
    ["Delivery service", shipment.service],
    ["Carrier", shipment.carrier],
    ["Tracking number", shipment.tracking],
  ] as const;
  const link = trackingUrl(pattern, shipment.tracking);
  const text = [
    greeting, "", intro, "", `${label}: ${shipment.reference}`, "", "Dispatched items:",
    ...items.map(({ sku, option_label, quantity }) => `${sku}${option_label ? ` — ${option_label}` : ""}: ${quantity}`),
    "", ...details.map(([key, value]) => `${key}: ${value}`),
    ...(link ? [`Track your parcel: ${link}`] : []),
    "", "Delivery address:", ...address,
  ].join("\n");
  const html = [
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Edgey ${title.toLowerCase()}</title></head><body>`,
    `<h1>${title}</h1><p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p>`,
    `<p>${label}: ${escapeHtml(shipment.reference)}</p>`,
    '<table><caption>Dispatched items</caption><thead><tr><th scope="col">SKU</th><th scope="col">Option</th><th scope="col">Quantity</th></tr></thead><tbody>',
    ...items.map(({ sku, option_label, quantity }) => `<tr><td>${escapeHtml(sku)}</td><td>${escapeHtml(option_label ?? "—")}</td><td>${quantity}</td></tr>`),
    "</tbody></table><dl>",
    ...details.map(([key, value]) => `<dt>${key}</dt><dd style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(value)}</dd>`),
    `<dt>Delivery address</dt><dd>${address.map(escapeHtml).join("<br>")}</dd></dl>`,
    ...(link ? [`<p><a href="${escapeHtml(link)}">Track your parcel</a></p>`] : []),
    "</body></html>",
  ].join("");
  return { from, to: [shipment.email], subject, text, html };
}
