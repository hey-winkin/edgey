import { expect, test } from "vitest";
import { canReceivePurchaseOrder, formatPurchaseAmount, purchaseVariances } from "@/lib/admin/purchase-orders";
import { groupDeliveryMatches, makePurchaseReceiptState, readDeliveryRows } from "@/lib/admin/delivery-editor-state";

const order = { id: "order", number: "PO-000041", revision: 2, lines: [
  { variantId: "first", sku: "LAB-A", bladeName: "Example straight blade", outstanding: 5 },
  { variantId: "second", sku: "LAB-B", bladeName: "Example round blade", outstanding: 3 },
  { variantId: "third", sku: "LAB-C", bladeName: "Example narrow blade", outstanding: 0 },
] satisfies [unknown, unknown, unknown] };

test("review reports short, over and unexpected lines relative to outstanding units", () => {
  const [first, second] = order.lines;
  expect(purchaseVariances(order, [
    { ...first, quantity: 2 }, { ...second, quantity: 4 },
    { variantId: "fourth", sku: "LAB-D", quantity: 1 },
  ])).toMatchObject([
    { variantId: "first", kind: "short", quantity: 3 }, { variantId: "second", kind: "over", quantity: 1 },
    { variantId: "fourth", kind: "unexpected", quantity: 1 },
  ]);
  expect(canReceivePurchaseOrder("sent")).toBe(true);
  expect(canReceivePurchaseOrder("part_received")).toBe(true);
  expect(canReceivePurchaseOrder("closed")).toBe(false);
});

test("planned lines use their saved variant identifiers even if an SKU was reused", () => {
  const reused = { ...order, lines: [order.lines[0], { ...order.lines[1], sku: order.lines[0].sku }] };
  const { draft } = makePurchaseReceiptState("delivery", "2026-11-21", reused);
  expect(readDeliveryRows(draft.rows, new Map(), false, reused).map(({ match }) => match?.variantId)).toEqual(["first", "second"]);
});

test("blank and zero quantities omit planned lines but not unexpected lines", () => {
  const state = makePurchaseReceiptState("delivery", "2026-11-21", order);
  const { draft } = state;
  const checks = groupDeliveryMatches(draft.rows.map(({ code }) => code), state.matches);
  const rows = draft.rows.slice(0, 2).map((row, index) => ({ ...row, quantity: index ? "0" : "" }));
  expect(readDeliveryRows(rows, checks, false, order).map(({ omitted }) => omitted)).toEqual([true, true]);
  expect(readDeliveryRows(rows, checks, false).map(({ omitted }) => omitted)).toEqual([false, false]);
});

test("display keeps integer minor units exact even above JavaScript's safe integer range", () => {
  expect(formatPurchaseAmount(900719925474099315n, "USD")).toBe("USD\u00a09,007,199,254,740,993.15");
});
