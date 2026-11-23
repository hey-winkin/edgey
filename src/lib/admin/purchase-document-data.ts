import "server-only";

import type { staffSession } from "@/lib/admin/auth";
import {
  purchaseDocumentCurrencies, purchaseDocumentDetails, type PurchaseDocument,
} from "./purchase-document";

type StaffDb = NonNullable<Awaited<ReturnType<typeof staffSession>>>["db"];

export async function readPurchaseDocument(db: StaffDb, id: string): Promise<PurchaseDocument | null> {
  const [order, buyerSettings] = await Promise.all([
    db.from("staff_purchase_orders").select(`
      number,document_revision,status,ordered_on,expected_on,
      costs:staff_purchase_order_costs(currency,supplier:staff_suppliers(name,contact_name,email,phone,address)),
      lines:staff_purchase_order_lines(
        variant_id,sku,blade_name,option_label,quantity,
        costs:staff_purchase_order_line_costs!purchase_order_line_costs_line_fkey(unit_price_minor,supplier_part_number,note)
      )
    `).eq("id", id).order("position", { referencedTable: "lines" }).maybeSingle(),
    db.from("staff_purchase_buyer_settings").select("name,address,email,company_number,vat_number").eq("id", true).maybeSingle(),
  ]);
  if (order.error || buyerSettings.error) throw new Error("Couldn’t load the purchase order document.");
  if (!order.data) return null;

  const costs = order.data.costs;
  const currency = purchaseDocumentCurrencies.find((candidate) => candidate === costs?.currency);
  if (!currency) throw new Error("The purchase order has no supported currency.");
  const buyer = buyerSettings.data;
  const supplier = costs?.supplier;

  return {
    number: order.data.number,
    revision: order.data.document_revision,
    status: order.data.status,
    orderedOn: order.data.ordered_on,
    expectedOn: order.data.expected_on,
    currency,
    buyer: purchaseDocumentDetails([
      ["Name", buyer?.name], ["Address", buyer?.address], ["Email", buyer?.email],
      ["Company number", buyer?.company_number], ["VAT number", buyer?.vat_number],
    ]),
    supplier: purchaseDocumentDetails([
      ["Name", supplier?.name], ["Contact", supplier?.contact_name], ["Address", supplier?.address],
      ["Email", supplier?.email], ["Phone", supplier?.phone],
    ]),
    lines: order.data.lines.map((line) => ({
      variantId: line.variant_id, sku: line.sku, name: line.blade_name, option: line.option_label, quantity: line.quantity,
      partNumber: line.costs?.supplier_part_number ?? null, note: line.costs?.note ?? null,
      unitPriceMinor: line.costs?.unit_price_minor ?? null,
    })),
  };
}
