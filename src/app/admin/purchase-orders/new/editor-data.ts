import { formatPoundsInput, parsePoundsToPence } from "@/lib/admin/pounds";
import { DELIVERY_QUANTITY_MAX, deliveryToday, parseDeliveryQuantity } from "@/lib/admin/deliveries";
import { normaliseFinderCode } from "@/lib/requests/finder-query";
import type { ExactPurchaseMatch, PurchaseVariant } from "@/lib/admin/purchase-catalogue";

export const currencies = ["GBP", "USD", "EUR"] as const;
export type PurchaseCurrency = typeof currencies[number];
export type EditablePurchaseStatus = "draft" | "sent" | "part_received";
export const maxPurchaseLines = 200;
export const maxImportBytes = 128 * 1024;
export const maxCodeLength = 80;
export const maxPartNumberLength = 120;
export const maxNoteLength = 500;
export const maxOrderNoteLength = 2_000;
export const purchaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReceivedPrice = { currency: PurchaseCurrency; unitMinor: number };

export type PurchaseLine = {
  product: PurchaseVariant;
  quantity: string;
  unitPrice: string;
  supplierPart: string;
  note: string;
  received: number;
  receivedPrice?: ReceivedPrice;
  prefilledPrice?: boolean;
};

export type PurchaseHeader = {
  supplier: string;
  ordered: string;
  expected: string;
  currency: PurchaseCurrency;
  exchange: string;
  shipping: string;
  duty: string;
  other: string;
  vat: string;
  vatPolicy: string;
  note: string;
};

export type PurchaseEditorState = {
  response: number;
  id: string;
  revision: number;
  status: EditablePurchaseStatus;
  header: PurchaseHeader;
  lines: PurchaseLine[];
  query: string;
  brand: string;
  page: number;
  results: PurchaseVariant[];
  more: boolean;
  exact: string;
  paste: string;
  preview?: ImportPreview[];
  suggestions: Record<string, number>;
  error?: { message: string; field?: string; area?: "picker" | "exact" | "import" };
  notice?: string;
  focus?: string;
};

export function blankPurchaseHeader(): PurchaseHeader {
  return {
    supplier: "", ordered: deliveryToday(), expected: "", currency: "GBP", exchange: "",
    shipping: "", duty: "", other: "", vat: "", vatPolicy: "", note: "",
  };
}

export function purchaseCurrency(value: unknown): value is PurchaseCurrency {
  return currencies.some((currency) => value === currency);
}

export function editablePurchaseStatus(value: unknown): value is EditablePurchaseStatus {
  return value === "draft" || value === "sent" || value === "part_received";
}

export function newPurchaseLine(product: PurchaseVariant): PurchaseLine {
  return { product, quantity: "1", unitPrice: "", supplierPart: "", note: "", received: 0 };
}

export function priceInput(value: number | null | undefined) {
  return formatPoundsInput(value);
}

export function stockPurchasePrefill(products: PurchaseVariant[], prices: ReadonlyMap<string, ReceivedPrice>) {
  const counts = { GBP: 0, USD: 0, EUR: 0 };
  for (const product of products) {
    const price = prices.get(product.id);
    if (price) counts[price.currency]++;
  }
  const currency = currencies.reduce((best, code) => counts[code] > counts[best] ? code : best);
  const lines = products.map((product): PurchaseLine => {
    const receivedPrice = prices.get(product.id);
    const prefilledPrice = receivedPrice?.currency === currency;
    return {
      ...newPurchaseLine(product), quantity: "", receivedPrice, prefilledPrice,
      unitPrice: prefilledPrice ? priceInput(receivedPrice.unitMinor) : "",
    };
  });
  return { currency, lines };
}

export function readPurchaseLinePrice(line: PurchaseLine, unitPrice: string, currency: string, alreadyCleared = false) {
  const untouchedPrefill = !alreadyCleared && line.prefilledPrice && line.receivedPrice &&
    parsePoundsToPence(unitPrice) === line.receivedPrice.unitMinor;
  const cleared = Boolean(untouchedPrefill && line.receivedPrice?.currency !== currency);
  return { unitPrice: cleared ? "" : unitPrice, prefilledPrice: Boolean(untouchedPrefill && !cleared), cleared };
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
}

function optionalMoney(value: string) {
  return value.trim() ? parsePoundsToPence(value) : null;
}

function validPrice(value: string) {
  return !value.trim() || optionalMoney(value) !== null;
}

export function purchasePayload(header: PurchaseHeader, lines: PurchaseLine[], status: EditablePurchaseStatus) {
  const fail = (message: string, field?: string) => ({ ok: false as const, message, field });
  const draft = status === "draft";
  if (header.supplier ? !purchaseId.test(header.supplier) : !draft) return fail("Choose a supplier.", "supplier_id");
  if (!validDate(header.ordered)) return fail("Enter a valid order date.", "ordered_on");
  if (header.expected && !validDate(header.expected)) return fail("Enter a valid expected date.", "expected_on");
  if (!purchaseCurrency(header.currency)) return fail("Choose GBP, USD or EUR.", "currency");

  const rate = header.exchange.trim();
  if (header.currency !== "GBP" && (rate
    ? !/^\d{1,7}(?:\.\d{1,8})?$/.test(rate) || Number(rate) <= 0 || Number(rate) > 1_000_000
    : !draft)) {
    return fail("Enter a positive rate in pounds per unit of the supplier currency.", "exchange_rate");
  }
  const { shipping, duty, other, vat } = header;
  for (const [field, text] of Object.entries({ shipping_minor: shipping, duty_minor: duty, other_minor: other, import_vat_minor: vat })) {
    if (!validPrice(text)) return fail("Enter a non-negative amount with up to two decimal places.", field);
  }
  if (header.vatPolicy && header.vatPolicy !== "include" && header.vatPolicy !== "exclude") {
    return fail("Choose whether import VAT is included in landed cost.", "include_import_vat");
  }
  if (!draft && Number(vat) > 0 && !header.vatPolicy) {
    return fail("Choose whether import VAT is included in landed cost.", "include_import_vat");
  }
  if (header.note.length > maxOrderNoteLength || header.note.includes("\0")) return fail("Check the order note.", "order_note");
  if ((!draft && !lines.length) || lines.length > maxPurchaseLines) {
    return fail(draft ? `Use up to ${maxPurchaseLines} lines per order.` : "Add at least one purchase-order line.");
  }

  const seen = new Set<string>();
  const payloadLines = [];
  for (const line of lines) {
    const variant_id = line.product.id;
    const quantity = parseDeliveryQuantity(line.quantity);
    if (!purchaseId.test(variant_id) || seen.has(variant_id)) return fail("Use one line per product.");
    seen.add(variant_id);
    if (quantity === null || quantity < line.received) {
      return fail(line.received
        ? `Enter at least ${line.received} units of ${line.product.sku} to cover receipts already recorded.`
        : `Enter a positive whole quantity for ${line.product.sku}.`, `quantity:${variant_id}`);
    }
    const unit_price_minor = optionalMoney(line.unitPrice);
    if (!validPrice(line.unitPrice) || (!draft && unit_price_minor === null)) {
      return fail(`Enter a non-negative unit price with up to two decimal places for ${line.product.sku}.`, `price:${variant_id}`);
    }
    if (line.supplierPart.length > maxPartNumberLength || /[\u0000-\u001f\u007f]/u.test(line.supplierPart)) {
      return fail(`Check the supplier part number for ${line.product.sku}.`, `part:${variant_id}`);
    }
    if (line.note.length > maxNoteLength || line.note.includes("\0")) {
      return fail(`Check the line note for ${line.product.sku}.`, `note:${variant_id}`);
    }
    payloadLines.push({
      variant_id, quantity, unit_price_minor,
      supplier_part_number: line.supplierPart.trim() || null, note: line.note.trim() || null,
    });
  }
  return {
    ok: true as const,
    order: {
      supplier_id: header.supplier || null, ordered_on: header.ordered, expected_on: header.expected || null,
      currency: header.currency, exchange_rate: header.currency === "GBP" ? "1" : rate || null,
      shipping_minor: optionalMoney(shipping) ?? 0, duty_minor: optionalMoney(duty) ?? 0,
      other_minor: optionalMoney(other) ?? 0, import_vat_minor: optionalMoney(vat) ?? 0,
      include_import_vat: header.vatPolicy ? header.vatPolicy === "include" : null,
      note: header.note.trim() || null,
    },
    lines: payloadLines,
  };
}

type ImportRow = {
  sourceRow: number;
  code: string;
  quantity: string;
  unitPrice: string;
  supplierPart: string;
  note: string;
};

export type ImportPreview = ImportRow & { product?: PurchaseVariant; error?: string };

const importHeaders = [
  /^(code|sku|edgey code|blade code|maker reference)$/,
  /^(quantity|qty)$/,
  /^unit (price|cost)$/,
  /^supplier part (number|no)$/,
  /^(line )?note$/,
] as const;
const normaliseHeader = (value: string) => value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

export function parsePurchaseImport(input: string, csvOnly = false):
  { ok: true; rows: ImportRow[] } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (new TextEncoder().encode(input).byteLength > maxImportBytes) return fail("Use a table no larger than 128 KB.");
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) return fail("Paste or upload at least one purchase-order line.");
  if (text.includes("\0")) return fail("Use a plain UTF-8 spreadsheet export.");
  const firstLine = text.split("\n").find((line) => line.trim()) ?? "";
  const separator = !csvOnly && firstLine.replace(/"(?:[^"]|"")*"/g, "").includes("\t") ? "\t" : ",";
  const rows: ImportRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  let line = 1;
  let sourceRow = 1;
  let columns = 5;
  let first = true;

  for (let index = 0; index <= text.length; index++) {
    const char = index < text.length ? text[index] : "\n";
    if (quoted && index < text.length) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else {
        field += char;
        if (char === "\n") line++;
      }
      continue;
    }
    if (quoted || (closed && char !== separator && char !== "\n")) return fail(`Check the quotes on row ${sourceRow}.`);
    if (char === separator || char === "\n") {
      fields.push(field.trim());
      field = "";
      closed = false;
      if (fields.length > columns) return fail(`Row ${sourceRow} has extra columns. Check the column order.`);
      if (char === separator) continue;

      if (fields.some(Boolean)) {
        const [code = "", quantity = "", unitPrice = "", supplierPart = "", note = ""] = fields;
        if (first && importHeaders[0].test(normaliseHeader(code)) && importHeaders[1].test(normaliseHeader(quantity))) {
          if (fields.some((header, i) => !importHeaders[i]?.test(normaliseHeader(header)))) {
            return fail("Use these column headings in order: code, quantity, unit price, supplier part number, line note.");
          }
          columns = fields.length;
        } else {
          if (rows.length === maxPurchaseLines) return fail(`Import up to ${maxPurchaseLines} lines at a time.`);
          if (code.length > maxCodeLength || quantity.length > 10 || unitPrice.length > 11 ||
              supplierPart.length > maxPartNumberLength || note.length > maxNoteLength) {
            return fail(`A value on row ${sourceRow} is too long. Check the columns.`);
          }
          rows.push({ sourceRow, code, quantity, unitPrice, supplierPart, note });
        }
        first = false;
      }
      fields = [];
      sourceRow = ++line;
    } else if (char === '"') {
      if (field) return fail(`Check the quotes on row ${sourceRow}.`);
      quoted = true;
    } else {
      field += char;
    }
  }
  return rows.length ? { ok: true, rows } : fail("Add at least one line below the headings.");
}

export function importRowCode(code: string) {
  return /[\u0000-\u001f\u007f]/u.test(code) ? "" : normaliseFinderCode(code);
}

export function previewPurchaseImport(
  rows: ImportRow[], matches: Map<string, ExactPurchaseMatch>, existing: Set<string>,
): ImportPreview[] {
  const used = new Set(existing);
  return rows.map((row) => {
    const match = matches.get(importRowCode(row.code));
    const product = match?.kind === "match" ? match.product : undefined;
    let error: string | undefined;
    if (!product) {
      error = match?.kind === "ambiguous" ? "This reference matches multiple products. Use the exact Edgey code." :
        "No selectable product matches this code.";
    } else if (used.has(product.id)) {
      error = existing.has(product.id) ? "This product is already on the order." : "This product is repeated in the import.";
    } else if (parseDeliveryQuantity(row.quantity) === null) {
      error = `Enter a whole quantity from 1 to ${DELIVERY_QUANTITY_MAX.toLocaleString("en-GB")}.`;
    } else if (!validPrice(row.unitPrice)) {
      error = "Enter a non-negative unit price with up to two decimal places, or leave it blank.";
    } else if (/[\u0000-\u001f\u007f]/u.test(row.supplierPart)) {
      error = "Use a single-line supplier part number.";
    }
    if (product) used.add(product.id);
    return { ...row, product, error };
  });
}
