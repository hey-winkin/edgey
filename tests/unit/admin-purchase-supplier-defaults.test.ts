import { beforeEach, expect, test, vi } from "vitest";
import { submitPurchaseEditor } from "@/app/admin/purchase-orders/new/actions";
import { blankPurchaseHeader, newPurchaseLine, type PurchaseEditorState } from "@/app/admin/purchase-orders/new/editor-data";
import { applyPurchaseDefaults, expectedPurchaseDate, purchaseRememberRequests, type SupplierAssociation } from "@/app/admin/purchase-orders/new/supplier-defaults";
import type { PurchaseVariant } from "@/lib/admin/purchase-catalogue";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(), rpc: vi.fn(), loadPurchaseAssociations: vi.fn(), getPurchaseVariants: vi.fn(),
  matchPurchaseCatalogueCodes: vi.fn(), redirect: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/admin/auth", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/lib/admin/purchase-catalogue", () => mocks);
vi.mock("@/app/admin/purchase-orders/new/supplier-defaults-load", () => mocks);
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const variant = (n: number, status: PurchaseVariant["status"] = "published"): PurchaseVariant => ({
  id: uuid(n), sku: `BLADE-${n}`, name: "Test blade", option: null, status,
});
const first = variant(1);
const second = variant(2);
const amber = uuid(20);
const blue = uuid(21);
const version = "2026-11-23T12:00:00.123456+00:00";
function association(product: PurchaseVariant, supplier: string, part: string, usual = true): SupplierAssociation {
  return { variant_id: product.id, supplier_id: supplier, supplier_part_number: part, is_usual: usual, updated_at: version };
}

function editor(products = [first], associations = [association(first, amber, "A-1"), association(first, blue, "B-1", false)]): PurchaseEditorState {
  return applyPurchaseDefaults({
    id: uuid(30), revision: 0, response: 0, status: "draft",
    header: { ...blankPurchaseHeader(), ordered: "2026-12-30" },
    lines: products.map(newPurchaseLine), query: "", brand: "", page: 1, results: [first, second], more: false,
    exact: "", paste: "", suggestions: {},
    defaults: {
      suppliers: [
        { id: amber, name: "Amber Components", default_currency: "USD", lead_time_days: 3 },
        { id: blue, name: "Blue Components", default_currency: "EUR", lead_time_days: 0 },
      ],
      rates: { USD: { value: "0.78123456", number: "PO-0042", ordered: "2026-11-21" } },
      associations, edited: {},
    },
  });
}

function post(state: PurchaseEditorState, intent: string, overrides: Record<string, string> = {}) {
  const h = state.header;
  const form = new FormData();
  for (const [name, value] of Object.entries({
    intent, order_id: state.id, revision: String(state.revision), supplier_id: h.supplier, ordered_on: h.ordered,
    expected_on: h.expected, currency: h.currency, exchange_rate: h.exchange, paste: state.paste,
  })) form.set(name, value);
  for (const line of state.lines) {
    const { id } = line.product;
    form.append("line", id);
    form.set(`quantity:${id}`, line.quantity);
    form.set(`price:${id}`, line.unitPrice);
    form.set(`part:${id}`, line.supplierPart);
  }
  for (const [name, value] of Object.entries(overrides)) form.set(name, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireStaff.mockResolvedValue({ db: { rpc: mocks.rpc } });
  mocks.getPurchaseVariants.mockResolvedValue(new Map([[second.id, second]]));
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

test("uses one common usual supplier, ignores archived variants, and never falls back to another supplier's part", () => {
  const archived = variant(3, "archived");
  const associations = [association(first, amber, "A-1"), association(second, amber, "A-2"),
    association(first, blue, "B-1", false), association(archived, blue, "B-3")];
  const same = editor([first, second, archived], associations);
  expect(same.header).toMatchObject({ supplier: amber, currency: "USD", expected: "2027-01-02", exchange: "0.78123456" });
  expect(same.lines.map(({ supplierPart }) => supplierPart)).toEqual(["A-1", "A-2", ""]);
  expect(editor([first, second], associations.filter(({ variant_id }) => variant_id !== second.id)).header.supplier).toBe("");
  const mixed = editor([first, second], [association(first, amber, "A-1"), association(second, blue, "B-2")]);
  expect(mixed.header.supplier).toBe("");
  expect(mixed.lines.map(({ supplierPart }) => supplierPart)).toEqual(["", ""]);
});

test("calculates a civil calendar date, including zero days, without spilling outside the supported input range", () => {
  expect(expectedPurchaseDate("2028-02-28", 1)).toBe("2028-02-29");
  expect(expectedPurchaseDate("2026-01-28", 0)).toBe("2026-01-28");
  expect(expectedPurchaseDate("2026-02-29", 1)).toBe("");
  expect(expectedPurchaseDate("9999-12-31", 1)).toBe("");
});

test("skips unsafe legacy part defaults without changing the source association", () => {
  for (const part of ["😀".repeat(61), "BAD" + String.fromCharCode(127)]) {
    const linked = association(first, amber, part);
    const state = editor([first], [linked]);
    expect(state.header.supplier).toBe(amber);
    expect(state.lines[0]?.supplierPart).toBe("");
    expect(state.defaults?.associations).toEqual([linked]);
  }
});

test("switches the native part scope without losing the typed part or explicit defaults", async () => {
  const initial = editor();
  const switched = await submitPurchaseEditor(initial, post(initial, "supplierDefaults", {
    supplier_id: blue, expected_on: "2027-03-04", exchange_rate: "0.8765", ["edited:currency"]: "1",
    [`part:${first.id}`]: "A-TYPED",
  }));
  expect(switched.header).toMatchObject({ supplier: blue, currency: "USD", expected: "2027-03-04", exchange: "0.8765" });
  expect(switched.lines[0]).toMatchObject({ supplierPart: "B-1", partDrafts: { [amber]: "A-TYPED" } });
  const restored = await submitPurchaseEditor(switched, post(switched, "supplierDefaults", { supplier_id: amber }));
  expect(restored.lines[0]?.supplierPart).toBe("A-TYPED");
  expect(restored.header).toMatchObject({ currency: "USD", expected: "2027-03-04", exchange: "0.8765" });
  const immediateSave = await submitPurchaseEditor(initial, post(initial, "save", { supplier_id: blue }));
  expect(immediateSave.error?.message).toContain("Review the part numbers");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

test("rechecks supplier consensus when adding and removing picker variants", async () => {
  const initial = editor();
  mocks.loadPurchaseAssociations.mockResolvedValue([association(second, blue, "B-2")]);
  const mixed = await submitPurchaseEditor(initial, post(initial, `add:${second.id}`));
  expect(mixed.header).toMatchObject({ supplier: "", currency: "GBP", expected: "", exchange: "" });
  expect(mixed.lines.map(({ supplierPart }) => supplierPart)).toEqual(["", ""]);
  const back = await submitPurchaseEditor(mixed, post(mixed, `remove:${second.id}`));
  expect(back.header.supplier).toBe(amber);
  expect(back.lines[0]?.supplierPart).toBe("A-1");
});

test("prefills a blank import part but keeps an explicit imported part and the reviewed currency", async () => {
  const initial = editor([], []);
  mocks.matchPurchaseCatalogueCodes.mockResolvedValue(new Map([
    ["BLADE1", { kind: "match", product: first }], ["BLADE2", { kind: "match", product: second }],
  ]));
  mocks.loadPurchaseAssociations.mockResolvedValue([association(first, amber, "A-1"), association(second, amber, "A-2")]);
  const preview = await submitPurchaseEditor(initial, post(initial, "preview", { paste: "BLADE-1,2,9.11\nBLADE-2,3,,IMPORTED" }));
  const added = await submitPurchaseEditor(preview, post(preview, "addImport"));
  expect(added.header).toMatchObject({ supplier: amber, currency: "GBP" });
  expect(added.lines.map(({ supplierPart, unitPrice }) => ({ supplierPart, unitPrice }))).toEqual([
    { supplierPart: "A-1", unitPrice: "9.11" }, { supplierPart: "IMPORTED", unitPrice: "" },
  ]);
});

test("remembers only explicitly selected supplier changes and allows a safe order-only retry", async () => {
  const initial = editor();
  expect(purchaseRememberRequests({ ...initial, lines: initial.lines.map((line) => ({ ...line, rememberPart: true })) })).toEqual([]);
  const form = post(initial, "save", { [`part:${first.id}`]: "A-NEW", [`remember:${first.id}`]: amber });
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "staff_variant_supplier_conflict" } });
  const stale = await submitPurchaseEditor(initial, form);
  expect(stale.error?.message).toContain("Uncheck Remember to save only this order");
  expect(stale.lines[0]).toMatchObject({ supplierPart: "A-NEW", rememberPart: true });
  expect(mocks.rpc).toHaveBeenLastCalledWith("save_staff_purchase_order_with_supplier_parts", expect.objectContaining({
    p_remember: [{ variant_id: first.id, expected_association_updated_at: version }],
    p_lines: [expect.objectContaining({ supplier_part_number: "A-NEW" })],
  }));
  await submitPurchaseEditor(stale, post(stale, "save"));
  expect(mocks.rpc).toHaveBeenLastCalledWith("save_staff_purchase_order", expect.objectContaining({ p_id: stale.id, p_expected_revision: 0 }));
  const firstSupplier = await submitPurchaseEditor(editor([first], []),
    post(editor([first], []), "supplierDefaults", { supplier_id: blue, [`remember:${first.id}`]: blue }));
  expect(purchaseRememberRequests(firstSupplier)).toEqual([{ variant_id: first.id, expected_association_updated_at: null }]);
});
