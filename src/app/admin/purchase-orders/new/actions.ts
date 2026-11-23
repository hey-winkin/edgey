"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/admin/auth";
import {
  getPurchaseVariants, matchPurchaseCatalogueCodes, purchaseCatalogueMaxPage, searchPurchaseCatalogue,
  type PurchaseVariant,
} from "@/lib/admin/purchase-catalogue";
import {
  importRowCode, maxCodeLength, maxImportBytes, maxNoteLength, maxOrderNoteLength, maxPartNumberLength,
  maxPurchaseLines, newPurchaseLine, parsePurchaseImport, previewPurchaseImport, priceInput, purchaseCurrency,
  purchaseId, purchasePayload, type PurchaseEditorState, type PurchaseLine,
} from "./editor-data";

type StaffDb = Awaited<ReturnType<typeof requireStaff>>["db"];

function field(form: FormData, name: string, limit: number) {
  const value = form.get(name);
  return typeof value === "string" ? value.slice(0, limit + 1) : "";
}

async function getLastPrice(db: StaffDb, state: PurchaseEditorState, variant: string) {
  if (!purchaseId.test(state.header.supplier)) return null;
  const { data, error } = await db.rpc("last_staff_purchase_price", {
    p_supplier_id: state.header.supplier, p_variant_id: variant, p_currency: state.header.currency,
  });
  if (error) throw new Error("Could not check the last paid price. Try again.");
  return data;
}

function saveError(error: { code: string; message: string }, revision: number) {
  if (error.code === "40001") return revision === 0
    ? "This draft may already be saved. Check the purchase orders list before starting a new one."
    : "This order changed while you were editing it. Open the saved order in another tab to check its current revision.";
  if (error.code === "42501") return "Your staff role cannot save purchase orders.";
  switch (error.message) {
    case "staff_supplier_not_found": return "That supplier is no longer available. Choose another supplier.";
    case "staff_purchase_order_not_editable": return "This purchase order is no longer editable.";
    case "staff_purchase_order_supplier_currency_locked": return "The supplier and currency cannot change after sending.";
    case "staff_purchase_order_below_received": return "Keep any received products on the order, with a quantity at least as high as the recorded receipts.";
    case "staff_purchase_order_variant_unavailable": return "A product you added is no longer available to order. Check the catalogue and remove it before saving.";
    case "staff_purchase_order_incomplete": return "Check the supplier, line prices, exchange rate and import VAT treatment before saving an amendment.";
    case "staff_purchase_cost_overflow": return "A landed cost is outside the allowed range. Check the unit prices, exchange rate and charges.";
    case "invalid_staff_purchase_order": return "Check the order details and lines before saving.";
    default: return "Could not confirm the save. Check the purchase orders list before starting a replacement order.";
  }
}

export async function submitPurchaseEditor(previous: PurchaseEditorState, form: FormData): Promise<PurchaseEditorState> {
  const { db } = await requireStaff("catalogue", "finance");
  const intent = field(form, "intent", 48);
  const id = field(form, "order_id", 36);
  const revisionText = field(form, "revision", 10);
  const revision = Number(revisionText);
  if (!previous || !Array.isArray(previous.lines) || !purchaseId.test(id) || id !== previous.id ||
      !/^\d{1,10}$/.test(revisionText) || revision !== previous.revision || revision > 2_147_483_647) {
    return { ...previous, error: { message: "This editor is out of date. Reopen the purchase order to continue." } };
  }
  const currency = field(form, "currency", 3);
  const supplier = field(form, "supplier_id", 36);
  const samePriceScope = supplier === previous.header.supplier && currency === previous.header.currency;
  const query = field(form, "q", maxCodeLength).trim().slice(0, maxCodeLength);
  const rawBrand = field(form, "brand", maxCodeLength);
  const brand = /^[a-z0-9-]{1,80}$/.test(rawBrand) ? rawBrand : "";
  const rawPaste = form.get("paste");
  const tooMuchPaste = typeof rawPaste === "string" && new TextEncoder().encode(rawPaste).byteLength > maxImportBytes;
  const paste = !tooMuchPaste && typeof rawPaste === "string" ? rawPaste : "";
  const posted = form.getAll("line");
  const known = new Map(previous.lines.map((line) => [line.product.id, line]));
  const seen = new Set<string>();
  const lines: PurchaseLine[] = [];
  for (const variant of posted.slice(0, maxPurchaseLines)) {
    if (typeof variant !== "string" || !purchaseId.test(variant) || seen.has(variant)) continue;
    const line = known.get(variant);
    if (!line) continue;
    seen.add(variant);
    lines.push({
      product: line.product, received: line.received,
      quantity: field(form, `quantity:${variant}`, 10),
      unitPrice: field(form, `price:${variant}`, 11),
      supplierPart: field(form, `part:${variant}`, maxPartNumberLength),
      note: field(form, `note:${variant}`, maxNoteLength),
    });
  }
  const state: PurchaseEditorState = {
    id, revision, status: previous.status, response: previous.response + 1,
    header: {
      supplier, ordered: field(form, "ordered_on", 10), expected: field(form, "expected_on", 10),
      currency: purchaseCurrency(currency) ? currency : previous.header.currency,
      exchange: field(form, "exchange_rate", 16),
      shipping: field(form, "shipping_minor", 11), duty: field(form, "duty_minor", 11),
      other: field(form, "other_minor", 11), vat: field(form, "import_vat_minor", 11),
      vatPolicy: field(form, "include_import_vat", 7), note: field(form, "order_note", maxOrderNoteLength),
    },
    lines, query, brand, page: previous.page, results: previous.results, more: previous.more,
    exact: field(form, "exact", maxCodeLength), paste,
    preview: paste === previous.paste && currency === previous.header.currency ? previous.preview : undefined,
    suggestions: samePriceScope ? Object.fromEntries(lines.flatMap(({ product, unitPrice }) => {
      const price = previous.suggestions[product.id];
      return !unitPrice.trim() && typeof price === "number" && Number.isSafeInteger(price) && price >= 0 ? [[product.id, price]] : [];
    })) : {},
  };
  function refuse(message: string, field?: string, area?: NonNullable<PurchaseEditorState["error"]>["area"]) {
    return { ...state, error: { message, field, area }, focus: area ? `po-${area}-error` : "po-save-error" };
  }
  if (!purchaseCurrency(currency)) return refuse("Choose GBP, USD or EUR.", "currency");
  if (posted.length !== lines.length || posted.length !== known.size) {
    return refuse("The purchase-order lines could not be read. Reopen the purchase order before saving.");
  }
  if (intent === "clearImport") return { ...state, paste: "", preview: undefined, focus: "po-import-toggle" };
  if (tooMuchPaste) return refuse("The pasted table exceeded 128 KB and wasn't kept. Paste a smaller table.", "paste", "import");

  const upload = form.get("file");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  if (file) {
    if (state.paste.trim()) return refuse("Choose either a CSV file or a pasted table.", "file", "import");
    if (!file.name.toLowerCase().endsWith(".csv")) return refuse("Choose a file ending in .csv.", "file", "import");
    if (file.size > maxImportBytes) return refuse("Choose a CSV file no larger than 128 KB.", "file", "import");
    try {
      state.paste = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      state.preview = undefined;
    } catch {
      return refuse("Save your spreadsheet as a UTF-8 CSV and try again.", "file", "import");
    }
  }
  if (intent === "save") {
    if (state.paste.trim() || file) return refuse("Import the staged table or clear it before saving.", "paste", "import");
    const payload = purchasePayload(state.header, state.lines, state.status);
    if (!payload.ok) return refuse(payload.message, payload.field);
    const { data, error } = await db.rpc("save_staff_purchase_order", {
      p_id: id, p_expected_revision: revision, p_order: payload.order, p_lines: payload.lines,
    });
    if (error) return refuse(saveError(error, revision));
    revalidatePath("/admin/purchase-orders");
    revalidatePath(`/admin/purchase-orders/${data}`);
    revalidatePath("/admin/stock");
    revalidatePath("/admin/catalogue");
    redirect(`/admin/purchase-orders/${data}`);
  }

  let area: NonNullable<PurchaseEditorState["error"]>["area"];
  try {
    if (intent === "search" || intent.startsWith("page:")) {
      area = "picker";
      const sameFilters = query === previous.query && brand === previous.brand;
      const page = intent === "page:next" && sameFilters ? Math.min(previous.page + 1, purchaseCatalogueMaxPage) :
        intent === "page:previous" && sameFilters ? Math.max(previous.page - 1, 1) : 1;
      const result = await searchPurchaseCatalogue(query, brand, page);
      return { ...state, ...result, page, focus: "po-results" };
    }

    if (intent === "preview" || intent === "addImport") {
      area = "import";
      const parsed = parsePurchaseImport(state.paste, !!file);
      if (!parsed.ok) return refuse(parsed.error, "paste", area);
      const matches = await matchPurchaseCatalogueCodes(parsed.rows.map(({ code }) => importRowCode(code)));
      state.preview = previewPurchaseImport(parsed.rows, matches, seen);
      if (state.lines.length + state.preview.length > maxPurchaseLines) {
        return refuse(`This order can have up to ${maxPurchaseLines} lines. Remove existing lines or import a smaller table.`, "paste", area);
      }
      if (intent === "preview") return { ...state, focus: "po-import-preview" };
      if (state.preview.some(({ product, error }) => !product || error)) {
        return refuse("Correct the flagged import rows and preview the table again.", "paste", area);
      }
      if (file || paste !== previous.paste || currency !== previous.header.currency ||
          state.preview.length !== previous.preview?.length ||
          !state.preview.every((row, index) => row.product?.id === previous.preview?.[index]?.product?.id && !previous.preview?.[index]?.error)) {
        return refuse("The import source, currency or matched products changed. Check the new preview before adding.", "paste", area);
      }
      const added = state.preview.flatMap(({ product, quantity, unitPrice, supplierPart, note }) =>
        product ? [{ ...newPurchaseLine(product), quantity, unitPrice, supplierPart, note }] : []);
      return {
        ...state, lines: [...state.lines, ...added], paste: "", preview: undefined,
        notice: `Added ${added.length} ${added.length === 1 ? "line" : "lines"} from the table.`,
        focus: `quantity:${added[0]?.product.id}`,
      };
    }

    if (intent === "exact" || intent.startsWith("add:")) {
      area = intent === "exact" ? "exact" : "picker";
      if (lines.length >= maxPurchaseLines) return refuse(`Use up to ${maxPurchaseLines} lines per order.`, undefined, area);
      let product: PurchaseVariant | undefined;
      if (intent === "exact") {
        const key = state.exact.length <= maxCodeLength ? importRowCode(state.exact) : "";
        if (!key) return refuse("Enter an exact Edgey code or maker reference.", "exact", area);
        const match = (await matchPurchaseCatalogueCodes([key])).get(key);
        if (match?.kind === "ambiguous") return refuse("This reference matches multiple products. Choose the right one in the catalogue picker.", "exact", area);
        if (match?.kind === "match") product = match.product;
      } else {
        const variant = intent.slice(4);
        if (purchaseId.test(variant)) product = (await getPurchaseVariants([variant])).get(variant);
      }
      if (!product || product.status === "archived") return refuse("No selectable product matches. Check the catalogue code or add a draft variant.", undefined, area);
      if (seen.has(product.id)) return refuse(`${product.sku} is already on the order. Change its quantity on the existing line.`, undefined, area);
      state.lines.push(newPurchaseLine(product));
      const price = await getLastPrice(db, state, product.id).catch(() => null);
      if (price !== null) state.suggestions[product.id] = price;
      if (intent === "exact") state.exact = "";
      return { ...state, notice: `Added ${product.sku}.`, focus: intent === "exact" ? "exact" : `quantity:${product.id}` };
    }

    const [verb, variant = ""] = intent.split(":");
    const line = lines.find(({ product }) => product.id === variant);
    if (verb === "remove" && line) {
      if (line.received > 0) return refuse("This product already has recorded receipts and cannot be removed.");
      state.lines = lines.filter(({ product }) => product.id !== variant);
      delete state.suggestions[variant];
      return { ...state, notice: `Removed ${line.product.sku}.`, focus: "po-lines" };
    }
    if ((verb === "lastPrice" || verb === "usePrice") && line) {
      if (line.unitPrice.trim()) return refuse("A price is already entered. Clear it first if you want to use the last paid price.", `price:${variant}`);
      if (!purchaseId.test(supplier)) return refuse("Choose a supplier to check its previous prices.", "supplier_id");
      const price = await getLastPrice(db, state, variant);
      if (price === null) {
        delete state.suggestions[variant];
        return { ...state, notice: `No previous received price for ${line.product.sku} in ${currency}.`, focus: `price:${variant}` };
      }
      if (verb === "usePrice" && price === state.suggestions[variant]) {
        line.unitPrice = priceInput(price);
        delete state.suggestions[variant];
        return { ...state, notice: `Used the last paid price for ${line.product.sku}.`, focus: `price:${variant}` };
      }
      state.suggestions[variant] = price;
      return { ...state, notice: `Last paid price found for ${line.product.sku}.`, focus: `usePrice:${variant}` };
    }
    return refuse("Choose an action to continue.");
  } catch {
    const message = area === "import" ? "Could not check the imported products. Try again." :
      area ? "Could not check the catalogue. Try again." : "Could not check the previous price. Try again.";
    return refuse(message, undefined, area);
  }
}
