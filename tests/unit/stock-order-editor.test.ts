import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import { submitPurchaseEditor } from "@/app/admin/purchase-orders/new/actions";
import { stockPurchasePrefill, type PurchaseEditorState } from "@/app/admin/purchase-orders/new/editor-data";
import { loadPurchaseEditor } from "@/app/admin/purchase-orders/new/editor-load";
import { PurchaseEditor } from "@/app/admin/purchase-orders/new/purchase-editor";
import type { PurchaseVariant } from "@/lib/admin/purchase-catalogue";
import { encodeStockSelection } from "@/lib/admin/stock-selection";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), requireStaff: vi.fn(), receiptPrice: vi.fn(), getPurchaseVariants: vi.fn(),
  purchaseCatalogueBrands: vi.fn(), searchPurchaseCatalogue: vi.fn(), redirect: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/lib/admin/purchase-catalogue", () => mocks);
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

function blade(n: number, status: PurchaseVariant["status"] = "published"): PurchaseVariant {
  return { id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, sku: `BLADE-${n}`, name: `Example blade ${n}`, option: null, status };
}

const first = blade(1);
const second = blade(2, "draft");
const third = blade(3);
const archived = blade(4, "archived");
const missing = blade(5);
const token = encodeStockSelection([third.id, first.id, archived.id, missing.id, second.id]);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireStaff.mockResolvedValue({ db: { from: mocks.from, rpc: mocks.rpc }, roles: ["finance"] });
  mocks.getPurchaseVariants.mockResolvedValue(new Map([first, second, third, archived].map((product) => [product.id, product])));
  mocks.purchaseCatalogueBrands.mockResolvedValue([]);
  mocks.searchPurchaseCatalogue.mockResolvedValue({ results: [], more: false });
  mocks.receiptPrice.mockImplementation(async (id: string) => ({
    data: id === third.id ? { variant_id: id, supplier_unit_minor: 978, currency: "EUR" } : {
      variant_id: id,
      supplier_unit_minor: id === first.id ? 1530 : 0, currency: "USD",
    },
    error: null,
  }));
  mocks.from.mockImplementation((table: string) => {
    if (table === "staff_suppliers") {
      return { select: () => ({ order: () => ({ order: async () => ({ data: [], error: null }) }) }) };
    }
    expect(table).toBe("staff_current_variant_costs");
    return {
      select: (columns: string) => {
        expect(columns).toBe("variant_id, supplier_unit_minor, currency");
        return { eq: (key: string, value: string) => {
          expect([key, value]).toEqual(["source", "receipt"]);
          return { in: async (column: string, ids: string[]) => {
            expect(column).toBe("variant_id");
            const results = await Promise.all(ids.map((id) => mocks.receiptPrice(id)));
            return { data: results.flatMap(({ data }) => data ? [data] : []), error: results.find(({ error }) => error)?.error };
          } };
        } };
      },
    };
  });
});

test("rechecks bulk IDs in selection order and leaves unavailable blades out with a notice", async () => {
  const { initial } = await loadPurchaseEditor(undefined, undefined, token);
  expect(mocks.requireStaff).toHaveBeenCalledExactlyOnceWith("catalogue", "finance");
  expect(mocks.getPurchaseVariants).toHaveBeenCalledExactlyOnceWith([third.id, first.id, archived.id, missing.id, second.id]);
  expect(mocks.receiptPrice.mock.calls.flat()).toEqual([third.id, first.id, second.id]);
  expect(initial.header).toMatchObject({ supplier: "", currency: "USD" });
  expect(initial.focus).toBe(`quantity:${third.id}`);
  expect(initial.notice).toMatch(/Skipped 2 blades/);
  expect(initial.lines).toMatchObject([
    { product: third, quantity: "", unitPrice: "", receivedPrice: { currency: "EUR", unitMinor: 978 } },
    { product: first, quantity: "", unitPrice: "15.30" },
    { product: second, quantity: "", unitPrice: "0.00" },
  ]);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

test("rejects malformed bulk tokens rather than falling back to a different blade, and keeps the single shortcut", async () => {
  const invalid = await loadPurchaseEditor(undefined, first.id, [token, token]);
  expect(invalid.initial.lines).toEqual([]);
  expect(invalid.initial.notice).toMatch(/invalid or empty/);
  const single = await loadPurchaseEditor(undefined, first.id);
  expect(single.initial.lines).toMatchObject([{ product: first, quantity: "1", unitPrice: "" }]);
  expect(single.initial.focus).toBeUndefined();
  expect(mocks.receiptPrice).not.toHaveBeenCalled();
});

test("falls back to GBP without history or if GBP ties for the most matching prices", () => {
  expect(stockPurchasePrefill([first], new Map()).currency).toBe("GBP");
  const prefill = stockPurchasePrefill([first, second], new Map([
    [first.id, { currency: "USD", unitMinor: 500 }], [second.id, { currency: "GBP", unitMinor: 550 }],
  ]));
  expect(prefill.currency).toBe("GBP");
  expect(prefill.lines.map(({ unitPrice }) => unitPrice)).toEqual(["", "5.50"]);
});

test("batches the latest effective received prices for a full stock order", async () => {
  const blades = Array.from({ length: 200 }, (_, i) => blade(i));
  mocks.getPurchaseVariants.mockResolvedValue(new Map(blades.map((product) => [product.id, product])));
  mocks.receiptPrice.mockResolvedValue({ data: null, error: null });
  const { initial } = await loadPurchaseEditor(undefined, undefined, encodeStockSelection(blades.map(({ id }) => id)));
  expect(initial.lines).toHaveLength(200);
  expect(mocks.receiptPrice).toHaveBeenCalledTimes(200);
  expect(mocks.from.mock.calls.filter(([table]) => table === "staff_current_variant_costs")).toHaveLength(5);
});

test("renders native autofocus only on the first blank quantity and shows original-currency amounts", async () => {
  const editor = await loadPurchaseEditor(undefined, undefined, token);
  const html = renderToStaticMarkup(createElement(PurchaseEditor, { ...editor, permalink: "/admin/purchase-orders/new" }));
  expect(html.match(/<input[^>]*autofocus[^>]*>/gi)).toEqual([expect.stringContaining(`name="quantity:${third.id}"`)]);
  expect(html).toMatch(/Last received unit price: <span[^>]*>EUR 9\.78<\/span>/);
  const quantityInputs = html.match(/<input[^>]*name="quantity:[^"]+"[^>]*>/g);
  expect(quantityInputs).toHaveLength(3);
  expect(quantityInputs?.every((markup) => markup.includes('value=""'))).toBe(true);
});

function submission(state: PurchaseEditorState, currency: string, prices: string[], intent = "save") {
  const form = new FormData();
  form.set("intent", intent);
  form.set("order_id", state.id);
  form.set("revision", String(state.revision));
  form.set("currency", currency);
  form.set("ordered_on", "2026-11-23");
  state.lines.forEach(({ product }, index) => {
    form.append("line", product.id);
    form.set(`quantity:${product.id}`, "3");
    form.set(`price:${product.id}`, prices[index] ?? "");
  });
  return form;
}

test("native Save refuses to relabel untouched defaults but keeps edited prices and receipt references", async () => {
  const { initial } = await loadPurchaseEditor(undefined, undefined, token);
  const result = await submitPurchaseEditor(initial, submission(initial, "EUR", ["", "15.3", "8.62"]));
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(result.error?.message).toMatch(/different currency were cleared/);
  expect(result.lines).toMatchObject([
    { product: third, unitPrice: "", receivedPrice: { currency: "EUR", unitMinor: 978 } },
    { product: first, unitPrice: "", receivedPrice: { currency: "USD", unitMinor: 1530 } },
    { product: second, unitPrice: "8.62" },
  ]);

  mocks.rpc.mockResolvedValue({ data: initial.id, error: null });
  await submitPurchaseEditor(result, submission(result, "EUR", ["9.78", "15.30", "8.62"]));
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("save_staff_purchase_order", expect.objectContaining({
    p_order: expect.objectContaining({ supplier_id: null, currency: "EUR" }),
    p_lines: [978, 1530, 862].map((unit_price_minor) => expect.objectContaining({ unit_price_minor })),
  }));
});

test("native picker requests keep price provenance so the next Save can still detect a currency change", async () => {
  const { initial } = await loadPurchaseEditor(undefined, undefined, token);
  const searched = await submitPurchaseEditor(initial, submission(initial, "USD", ["", "15.30", "0.00"], "search"));
  expect(searched.lines[1]?.prefilledPrice).toBe(true);
  const result = await submitPurchaseEditor(searched, submission(searched, "GBP", ["", "15.30", "0.00"]));
  expect(result.lines.map(({ unitPrice }) => unitPrice)).toEqual(["", "", ""]);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

test("keeps an amount explicitly re-entered after the browser already cleared the prefill", async () => {
  const { initial } = await loadPurchaseEditor(undefined, undefined, token);
  const form = submission(initial, "EUR", ["", "15.30", "0.00"], "search");
  form.set(`prefill_cleared:${first.id}`, "1");
  const result = await submitPurchaseEditor(initial, form);
  expect(result.lines[1]).toMatchObject({ unitPrice: "15.30", prefilledPrice: false });
  expect(result.lines[2]).toMatchObject({ unitPrice: "", prefilledPrice: false });
});
