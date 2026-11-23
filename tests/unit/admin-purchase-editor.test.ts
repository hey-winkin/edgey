import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitPurchaseEditor } from "@/app/admin/purchase-orders/new/actions";
import {
  blankPurchaseHeader, maxImportBytes, newPurchaseLine, parsePurchaseImport, previewPurchaseImport,
  purchasePayload, type PurchaseEditorState,
} from "@/app/admin/purchase-orders/new/editor-data";
import type { ExactPurchaseMatch, PurchaseVariant } from "@/lib/admin/purchase-catalogue";

const { requireStaff, rpc, matchCodes, getVariants, search, revalidatePath, redirect } = vi.hoisted(() => ({
  requireStaff: vi.fn(), rpc: vi.fn(), matchCodes: vi.fn(), getVariants: vi.fn(), search: vi.fn(),
  revalidatePath: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`Redirected to ${path}`); }),
}));

vi.mock("@/lib/admin/auth", () => ({ requireStaff }));
vi.mock("@/lib/admin/purchase-catalogue", () => ({
  getPurchaseVariants: getVariants, matchPurchaseCatalogueCodes: matchCodes, searchPurchaseCatalogue: search,
  purchaseCatalogueMaxPage: 10_000,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const orderId = "10000000-0000-0000-0000-000000000001";
const supplierId = "10000000-0000-0000-0000-000000000002";
const variant: PurchaseVariant = {
  id: "10000000-0000-0000-0000-000000000003", sku: "TEST-BLADE", name: "Test oscillating blade",
  option: "45 degrees", status: "draft",
};
const second: PurchaseVariant = { ...variant, id: "10000000-0000-0000-0000-000000000004", sku: "TEST-SECOND" };

function editor(): PurchaseEditorState {
  return {
    id: orderId, revision: 0, response: 0, status: "draft",
    header: { ...blankPurchaseHeader(), supplier: supplierId, ordered: "2026-10-30", currency: "USD" },
    lines: [newPurchaseLine(variant)], query: "", brand: "", page: 1, results: [variant, second],
    more: false, exact: "", paste: "", suggestions: {},
  };
}

function posted(state: PurchaseEditorState, intent: string) {
  const { header } = state;
  const entries = {
    intent, order_id: state.id, revision: String(state.revision), q: state.query, brand: state.brand,
    exact: state.exact, paste: state.paste, supplier_id: header.supplier, ordered_on: header.ordered,
    expected_on: header.expected, currency: header.currency, exchange_rate: header.exchange, shipping_minor: header.shipping,
    duty_minor: header.duty, other_minor: header.other, import_vat_minor: header.vat, include_import_vat: header.vatPolicy,
    order_note: header.note,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  for (const line of state.lines) {
    form.append("line", line.product.id);
    form.set(`quantity:${line.product.id}`, line.quantity);
    form.set(`price:${line.product.id}`, line.unitPrice);
    form.set(`part:${line.product.id}`, line.supplierPart);
    form.set(`note:${line.product.id}`, line.note);
  }
  return form;
}

describe("purchase-order editor inputs", () => {
  it("preserves missing draft prices and rates, but saves a fixed GBP rate and integer minor charges", () => {
    const { header, lines } = editor();
    expect(purchasePayload({ ...header, supplier: "", shipping: "10.09" }, lines, "draft")).toEqual({
      ok: true,
      order: {
        supplier_id: null, ordered_on: "2026-10-30", expected_on: null, currency: "USD", exchange_rate: null,
        shipping_minor: 1009, duty_minor: 0, other_minor: 0, import_vat_minor: 0, include_import_vat: null, note: null,
      },
      lines: [{ variant_id: variant.id, quantity: 1, unit_price_minor: null, supplier_part_number: null, note: null }],
    });
    expect(purchasePayload({ ...header, currency: "GBP", exchange: "0.63" }, [], "draft")).toMatchObject({
      ok: true, order: { exchange_rate: "1" }, lines: [],
    });
  });

  it("requires explicit VAT treatment and enforces received quantity and costing for an amendment", () => {
    const { header } = editor();
    const line = { ...newPurchaseLine(variant), quantity: "5", unitPrice: "0.00", received: 3 };
    const costing = { ...header, exchange: "0.75999999", vat: "6.23" };
    expect(purchasePayload(costing, [line], "sent")).toMatchObject({ ok: false, field: "include_import_vat" });
    expect(purchasePayload(costing, [line], "draft")).toMatchObject({ ok: true, order: { include_import_vat: null } });
    const complete = { ...costing, vatPolicy: "exclude" };
    expect(purchasePayload(complete, [line], "part_received")).toMatchObject({
      ok: true, order: { exchange_rate: "0.75999999", import_vat_minor: 623, include_import_vat: false },
      lines: [{ unit_price_minor: 0 }],
    });
    expect(purchasePayload(complete, [{ ...line, unitPrice: "" }], "sent")).toMatchObject({ ok: false, field: `price:${variant.id}` });
    expect(purchasePayload(complete, [{ ...line, quantity: "2" }], "part_received")).toMatchObject({
      ok: false, field: `quantity:${variant.id}`, message: expect.stringContaining("at least 3"),
    });
  });

  it("rejects invalid calendar dates, unsupported rates and imprecise money", () => {
    const { header, lines } = editor();
    expect(purchasePayload({ ...header, ordered: "2026-02-29" }, lines, "draft")).toMatchObject({ ok: false, field: "ordered_on" });
    for (const exchange of ["0", "1e-3", "0.123456789", "1000001"]) {
      expect(purchasePayload({ ...header, exchange }, lines, "draft")).toMatchObject({ ok: false, field: "exchange_rate" });
    }
    for (const shipping of ["£1", "1.001", "-1", "21474836.48"]) {
      expect(purchasePayload({ ...header, shipping }, lines, "draft")).toMatchObject({ ok: false, field: "shipping_minor" });
    }
  });

  it("parses CSV and pasted tabs without discarding quotes, amounts or optional details", () => {
    expect(parsePurchaseImport('\uFEFFsku,qty,unit_price,supplier_part_number,line_note\r\nTEST-BLADE,3,4.50,"X,5","First\r\nand ""second"""\r\nTEST-SECOND,7', true)).toEqual({
      ok: true, rows: [
        { sourceRow: 2, code: "TEST-BLADE", quantity: "3", unitPrice: "4.50", supplierPart: "X,5", note: 'First\nand "second"' },
        { sourceRow: 4, code: "TEST-SECOND", quantity: "7", unitPrice: "", supplierPart: "", note: "" },
      ],
    });
    expect(parsePurchaseImport("code\tquantity\tunit cost\nTEST-BLADE\t3\t4.5")).toMatchObject({
      ok: true, rows: [{ code: "TEST-BLADE", quantity: "3", unitPrice: "4.5" }],
    });
  });

  it("rejects malformed quotes, incorrect columns, excessive rows, non-text and excessive bytes", () => {
    for (const input of [
      'TEST-BLADE,2,"4.50',
      "code,quantity,total\nTEST-BLADE,7,4.50",
      "code,quantity\nTEST-BLADE,7,4.50",
      "TEST,1\n".repeat(201),
      "TEST\0,1",
      "😀".repeat(maxImportBytes / 4 + 1),
    ]) expect(parsePurchaseImport(input)).toMatchObject({ ok: false });
  });

  it("marks ambiguity, misses, existing products, duplicate matches, and invalid quantities without guessing", () => {
    const parsed = parsePurchaseImport("REF-AMB,2\nUNKNOWN,1\nTEST-BLADE,5\nTEST-SECOND,0\nREF-SECOND,1");
    if (!parsed.ok) throw new Error(parsed.error);
    const matches = new Map<string, ExactPurchaseMatch>([
      ["REFAMB", { kind: "ambiguous" }], ["TESTBLADE", { kind: "match", product: variant }],
      ["TESTSECOND", { kind: "match", product: second }], ["REFSECOND", { kind: "match", product: second }],
    ]);
    expect(previewPurchaseImport(parsed.rows, matches, new Set([variant.id])).map((row) => row.error)).toEqual([
      expect.stringContaining("multiple"), expect.stringContaining("No selectable"),
      expect.stringContaining("already"), expect.stringContaining("whole quantity"), expect.stringContaining("repeated"),
    ]);
  });
});

describe("purchase-order server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireStaff.mockResolvedValue({ db: { rpc } });
    rpc.mockResolvedValue({ data: 199, error: null });
    matchCodes.mockResolvedValue(new Map([["TESTSECOND", { kind: "match", product: second }]]));
    getVariants.mockResolvedValue(new Map([[second.id, second]]));
  });

  it("requires a cost role before using the catalogue, import or save actions", async () => {
    requireStaff.mockRejectedValue(new Error("Warehouse role does not see costs"));
    const state = editor();
    for (const intent of ["search", "preview", `add:${second.id}`, "save"]) {
      await expect(submitPurchaseEditor(state, posted(state, intent))).rejects.toThrow();
    }
    expect(requireStaff).toHaveBeenCalledWith("catalogue", "finance");
    expect(rpc).not.toHaveBeenCalled();
    expect(matchCodes).not.toHaveBeenCalled();
    expect(getVariants).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("keeps native form values while searching by product name and machine brand without writing", async () => {
    const state = editor();
    const form = posted(state, "search");
    form.set("q", " oscillating blade ");
    form.set("brand", "zund");
    form.set("order_note", "First line\nSecond line");
    form.set(`quantity:${variant.id}`, "18");
    form.set(`price:${variant.id}`, "3.21");
    search.mockResolvedValue({ results: [variant], more: true });
    await expect(submitPurchaseEditor(state, form)).resolves.toMatchObject({
      header: { note: "First line\nSecond line" }, lines: [{ quantity: "18", unitPrice: "3.21" }],
      page: 1, results: [variant], more: true,
    });
    expect(search).toHaveBeenCalledWith("oscillating blade", "zund", 1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("adds one catalogue product without replacing user values and offers the last paid price for its supplier and currency", async () => {
    const state = editor();
    const form = posted(state, `add:${second.id}`);
    form.set(`price:${variant.id}`, "10.87");
    const next = await submitPurchaseEditor(state, form);
    expect(next.lines).toEqual([
      { ...newPurchaseLine(variant), unitPrice: "10.87" }, newPurchaseLine(second),
    ]);
    expect(next.suggestions).toEqual({ [second.id]: 199 });
    expect(rpc).toHaveBeenCalledWith("last_staff_purchase_price",
      { p_supplier_id: supplierId, p_variant_id: second.id, p_currency: "USD" });

    const inserted = await submitPurchaseEditor(next, posted(next, `usePrice:${second.id}`));
    expect(inserted.lines[1]?.unitPrice).toBe("1.99");
    const typed = posted(next, `usePrice:${second.id}`);
    typed.set(`price:${second.id}`, "0");
    await expect(submitPurchaseEditor(next, typed)).resolves.toMatchObject({
      lines: [expect.anything(), { unitPrice: "0" }], error: { field: `price:${second.id}` },
    });
  });

  it("does not use a last-paid proposal after changing supplier currency or after price history changes", async () => {
    const state = { ...editor(), suggestions: { [variant.id]: 145 } };
    const form = posted(state, `usePrice:${variant.id}`);
    form.set("currency", "EUR");
    await expect(submitPurchaseEditor(state, form)).resolves.toMatchObject({
      lines: [{ unitPrice: "" }], suggestions: { [variant.id]: 199 },
    });
    await expect(submitPurchaseEditor(state, posted(state, `usePrice:${variant.id}`))).resolves.toMatchObject({
      lines: [{ unitPrice: "" }], suggestions: { [variant.id]: 199 },
    });
  });

  it("keeps an archived or ambiguous product off new lines", async () => {
    getVariants.mockResolvedValue(new Map([[second.id, { ...second, status: "archived" }]]));
    matchCodes.mockResolvedValue(new Map([["TESTSECOND", { kind: "ambiguous" }]]));
    const state = editor();
    await expect(submitPurchaseEditor(state, posted(state, `add:${second.id}`))).resolves.toMatchObject({
      lines: state.lines, error: { area: "picker" },
    });
    await expect(submitPurchaseEditor(state, posted({ ...state, exact: "TEST-SECOND" }, "exact"))).resolves.toMatchObject({
      lines: state.lines, error: { area: "exact", message: expect.stringContaining("multiple") },
    });
  });

  it("previews an uploaded CSV, refuses edited and unpreviewed sources, then appends confirmed lines", async () => {
    const state = editor();
    const form = posted(state, "preview");
    form.set("file", new File(["sku,qty,unit price\nTEST-SECOND,4,5.79"], "test.csv"));
    const preview = await submitPurchaseEditor(state, form);
    expect(preview).toMatchObject({ lines: state.lines, preview: [{ quantity: "4", unitPrice: "5.79", product: second }] });
    const modified = posted(preview, "addImport");
    modified.set("paste", "TEST-SECOND,40,5.79");
    await expect(submitPurchaseEditor(preview, modified)).resolves.toMatchObject({ lines: state.lines, error: { area: "import" } });
    await expect(submitPurchaseEditor(preview, posted(preview, "addImport"))).resolves.toMatchObject({
      lines: [state.lines[0], { product: second, quantity: "4", unitPrice: "5.79" }], paste: "",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses pending imports and sends one atomic save with revision and exact RPC keys", async () => {
    const state = editor();
    const staged = posted(state, "save");
    staged.set("paste", "TEST-SECOND,4,5.79");
    await expect(submitPurchaseEditor(state, staged)).resolves.toMatchObject({ error: { area: "import" } });
    expect(rpc).not.toHaveBeenCalled();

    rpc.mockResolvedValue({ data: orderId, error: null });
    const save = posted(state, "save");
    save.set(`quantity:${variant.id}`, "4");
    save.set(`price:${variant.id}`, "1.17");
    save.set(`part:${variant.id}`, "Fictional-1");
    await expect(submitPurchaseEditor(state, save)).rejects.toThrow(`Redirected to /admin/purchase-orders/${orderId}`);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_staff_purchase_order", {
      p_id: orderId, p_expected_revision: 0,
      p_order: expect.objectContaining({ supplier_id: supplierId, ordered_on: state.header.ordered, currency: "USD", exchange_rate: null }),
      p_lines: [{ variant_id: variant.id, quantity: 4, unit_price_minor: 117, supplier_part_number: "Fictional-1", note: null }],
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/purchase-orders/${orderId}`);
  });

  it("keeps entered values after a revision conflict instead of retrying without the expected revision", async () => {
    const state = { ...editor(), revision: 2 };
    const form = posted(state, "save");
    form.set(`quantity:${variant.id}`, "17");
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "staff_purchase_order_revision_conflict" } });
    await expect(submitPurchaseEditor(state, form)).resolves.toMatchObject({
      revision: 2, lines: [{ quantity: "17" }], error: { message: expect.stringContaining("changed") },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_staff_purchase_order", expect.objectContaining({ p_expected_revision: 2 }));
    expect(redirect).not.toHaveBeenCalled();
  });
});
