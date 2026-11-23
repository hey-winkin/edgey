import "server-only";

import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/auth";
import { getPurchaseVariants, purchaseCatalogueBrands, searchPurchaseCatalogue } from "@/lib/admin/purchase-catalogue";
import type { PurchaseVariant } from "@/lib/admin/purchase-catalogue";
import { purchaseRoles } from "@/lib/admin/roles";
import { stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { decodeStockSelection } from "@/lib/admin/stock-selection";
import {
  blankPurchaseHeader, editablePurchaseStatus, maxPurchaseLines, newPurchaseLine, priceInput,
  purchaseCurrency, purchaseId, stockPurchasePrefill, type PurchaseCurrency, type PurchaseEditorState, type ReceivedPrice,
} from "./editor-data";

export type PurchaseSupplierOption = { id: string; name: string; default_currency: PurchaseCurrency | null };
export type PurchaseBrand = { slug: string; name: string };

type StaffDb = Awaited<ReturnType<typeof requireStaff>>["db"];

async function latestReceivedPrices(db: StaffDb, products: PurchaseVariant[]) {
  if (!products.length) return new Map<string, ReceivedPrice>();
  const ids = products.map(({ id }) => id);
  const batches = await Promise.all(Array.from({ length: Math.ceil(ids.length / 40) }, (_, i) =>
    db.from("staff_current_variant_costs").select("variant_id, supplier_unit_minor, currency")
      .eq("source", "receipt").in("variant_id", ids.slice(i * 40, (i + 1) * 40))));
  if (batches.some(({ error }) => error)) {
    console.error("Could not load last received purchase prices.");
    return null;
  }
  const prices = new Map<string, ReceivedPrice>();
  for (const { data } of batches) {
    for (const { variant_id, supplier_unit_minor, currency } of data ?? []) {
      if (purchaseCurrency(currency)) prices.set(variant_id, { unitMinor: supplier_unit_minor, currency });
    }
  }
  return prices;
}

export async function loadPurchaseEditor(id?: string, prefill?: string, stockSelection?: unknown) {
  const { db, roles } = await requireStaff(...purchaseRoles);
  if (id && !purchaseId.test(id)) notFound();
  const order = id ? await db.from("staff_purchase_orders").select(`
    number, status, revision, ordered_on, expected_on,
    staff_purchase_order_costs(supplier_id, currency, exchange_rate, shipping_minor, duty_minor, other_minor,
      import_vat_minor, include_import_vat, note),
    staff_purchase_order_lines(variant_id, sku, blade_name, option_label, quantity, received_quantity,
      staff_purchase_order_line_costs(unit_price_minor, supplier_part_number, note))
  `).eq("id", id).order("position", { referencedTable: "staff_purchase_order_lines" }).maybeSingle() : null;
  if (order?.error && stockSchemaUnavailable(order.error)) notFound();
  if (order?.error) throw new Error("Could not open the purchase order.");
  const record = order?.data;
  if (id && (!record || !editablePurchaseStatus(record.status))) notFound();
  const status = record && editablePurchaseStatus(record.status) ? record.status : "draft";
  const costs = record?.staff_purchase_order_costs;
  if (record && (!costs || !purchaseCurrency(costs.currency))) throw new Error("Could not load the purchase-order costs.");
  const savedLines = record?.staff_purchase_order_lines ?? [];
  const fromStock = !id && stockSelection !== undefined;
  const stockIds = fromStock ? decodeStockSelection(stockSelection) : [];
  const prefillId = !fromStock && prefill && purchaseId.test(prefill) && status === "draft" ? prefill.toLowerCase() : undefined;
  const neededIds = [...new Set([...savedLines.map(({ variant_id }) => variant_id), ...stockIds, ...(prefillId ? [prefillId] : [])])];
  const [suppliers, brands, products, picker] = await Promise.all([
    db.from("staff_suppliers").select("id, name, default_currency").order("name").order("id"),
    purchaseCatalogueBrands(),
    getPurchaseVariants(neededIds),
    searchPurchaseCatalogue("", "", 1),
  ]);
  if (suppliers.error && stockSchemaUnavailable(suppliers.error)) notFound();
  if (suppliers.error) throw new Error("Could not load the suppliers.");

  const initial: PurchaseEditorState = {
    id: id ?? randomUUID(), revision: record?.revision ?? 0, status, response: 0,
    header: costs && record && purchaseCurrency(costs.currency) ? {
      supplier: costs.supplier_id ?? "", ordered: record.ordered_on, expected: record.expected_on ?? "",
      currency: costs.currency, exchange: costs.currency === "GBP" || costs.exchange_rate == null ? "" :
        costs.exchange_rate.toLocaleString("en-GB", { useGrouping: false, maximumFractionDigits: 8 }),
      shipping: priceInput(costs.shipping_minor), duty: priceInput(costs.duty_minor), other: priceInput(costs.other_minor),
      vat: priceInput(costs.import_vat_minor),
      vatPolicy: costs.include_import_vat === null ? "" : costs.include_import_vat ? "include" : "exclude",
      note: costs.note ?? "",
    } : blankPurchaseHeader(),
    lines: savedLines.map((line) => {
      const current = products.get(line.variant_id);
      const product: PurchaseVariant = {
        id: line.variant_id, sku: line.sku, name: line.blade_name, option: line.option_label,
        status: current?.status ?? "archived", drawing: current?.sku === line.sku ? current.drawing : undefined,
      };
      const lineCosts = line.staff_purchase_order_line_costs;
      return {
        product, quantity: String(line.quantity), received: line.received_quantity,
        unitPrice: priceInput(lineCosts?.unit_price_minor),
        supplierPart: lineCosts?.supplier_part_number ?? "", note: lineCosts?.note ?? "",
      };
    }),
    query: "", brand: "", page: 1, ...picker, exact: "", paste: "", suggestions: {},
  };
  if (fromStock) {
    const selected = stockIds.flatMap((id) => {
      const product = products.get(id);
      return product && product.status !== "archived" ? [product] : [];
    });
    const prices = await latestReceivedPrices(db, selected);
    const { currency, lines } = stockPurchasePrefill(selected, prices ?? new Map());
    initial.header.currency = currency;
    initial.lines = lines;
    const first = lines[0];
    if (first) initial.focus = `quantity:${first.product.id}`;
    const skipped = stockIds.length - selected.length;
    const added = lines.length ? `Added ${lines.length} ${lines.length === 1 ? "blade" : "blades"}. Enter quantities, then save a draft.` : "";
    const unavailable = skipped ? `Skipped ${skipped} ${skipped === 1 ? "blade that is" : "blades that are"} archived or no longer available.` : "";
    initial.notice = stockIds.length
      ? [added, unavailable, prices ? "" : "Could not load last received prices. Enter the supplier prices manually."].filter(Boolean).join(" ")
      : "This stock selection is invalid or empty. Select blades in Stock and try again.";
  } else if (prefill !== undefined) {
    const product = prefillId ? products.get(prefillId) : undefined;
    if (status !== "draft") {
      initial.error = { message: "Catalogue shortcuts can only add to a draft. Use the picker to amend this order." };
    } else if (!product || product.status === "archived") {
      initial.error = { message: "That catalogue product isn't available to order. Choose a product in the picker." };
    } else if (initial.lines.some((line) => line.product.id === product.id)) {
      initial.notice = `${product.sku} is already on this order.`;
    } else if (initial.lines.length >= maxPurchaseLines) {
      initial.error = { message: `This order already has ${maxPurchaseLines} lines.` };
    } else {
      initial.lines.push(newPurchaseLine(product));
      initial.notice = `${product.sku} was added. Save to keep it on the order.`;
    }
  }

  return {
    initial, brands, number: record?.number, canAddDraft: roles.includes("catalogue"),
    suppliers: suppliers.data.map((item): PurchaseSupplierOption => ({
      ...item, default_currency: purchaseCurrency(item.default_currency) ? item.default_currency : null,
    })),
  };
}
