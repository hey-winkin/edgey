import { describe, expect, it } from "vitest";
import { MAX_ORDER_INTEGER } from "@/lib/checkout/validation";
import type { CommerceVariant } from "@/lib/commerce";
import {
  groupedQuantities, isReady, matchQuickOrderLine, parseQuickOrder, planQuickOrder, type Blade, type OrderLine,
} from "@/lib/quick-order/order";

const blade: Blade = { id: "one", sku: "EDG-Z10", slug: "edg-z10", name: "Flat-stock drag blade", optionLabel: null, tool: null };
const other = { ...blade, id: "two", sku: "EDG-Z11" };
const stock: CommerceVariant = {
  ...blade, availableQuantity: 20, tierPrices: { oneToFour: 2250, fiveToNine: 1995, tenPlus: 1750 },
};
const line = (number: number, quantity: number, code = "3910301"): OrderLine =>
  ({ number, quantity, code, input: `${code} ${quantity}` });

describe("quick order input", () => {
  it("reads spreadsheet and email formats, including printed codes containing spaces", () => {
    const result = parseQuickOrder(' edg-z10\t2\r\n\r\n"SPB 0030","5"\r391 0301   10\n391-231, 1');
    expect(result.lines).toMatchObject([
      { number: 1, code: "edg-z10", quantity: 2 }, { number: 3, code: "SPB 0030", quantity: 5 },
      { number: 4, code: "391 0301", quantity: 10 }, { number: 5, code: "391-231", quantity: 1 },
    ]);
    expect(result.issue).toBeUndefined();
  });

  it("keeps valid lines alongside malformed and oversized quantities", () => {
    const result = parseQuickOrder(`x,0\nx,2.5\nx,1e3\nx,${MAX_ORDER_INTEGER + 1}\nx,1,2\nx,${MAX_ORDER_INTEGER}`);
    expect(result.lines.slice(0, 5).every((row) => "issue" in row)).toBe(true);
    expect(result.lines[5]).toMatchObject({ quantity: MAX_ORDER_INTEGER });
    expect(parseQuickOrder(" \n").issue).toBeTruthy();
    expect(parseQuickOrder("a 1\n".repeat(26)).lines).toEqual([]);
    expect(parseQuickOrder("x".repeat(4001)).lines).toEqual([]);
  });
});

describe("quick order basket rules", () => {
  it("never guesses between exact candidates and rechecks the chosen match", () => {
    const request = line(1, 2);
    expect(matchQuickOrderLine(request, [blade, other])).toMatchObject({
      candidates: [blade, other], issue: expect.stringContaining("more than one"),
    });
    expect(matchQuickOrderLine(request, [blade, other], other.id)).toMatchObject({ blade: other, chosen: true });
    expect(isReady(matchQuickOrderLine(request, [other], blade.id))).toBe(false);
    expect(isReady(matchQuickOrderLine(request, [other], undefined, blade.id))).toBe(false);
    expect(isReady(matchQuickOrderLine(request, [blade, other], undefined, blade.id))).toBe(false);
  });

  it("combines aliases and existing basket quantities before checking prices and stock", () => {
    const rows = [matchQuickOrderLine(line(1, 3), [blade]), matchQuickOrderLine(line(2, 2, blade.sku), [blade])];
    const basket = [{ variantId: blade.id, quantity: 5 }];
    const plan = planQuickOrder(rows, [stock], groupedQuantities(rows), basket, [stock]);
    expect(plan.lines).toEqual([{ variantId: blade.id, quantity: 10 }]);
    expect(plan.rows).toMatchObject([
      { price: { unit: 1750, minimum: 10, combinedQuantity: 10 } },
      { price: { unit: 1750, minimum: 10, combinedQuantity: 10 } },
    ]);
    const shortage = planQuickOrder(rows, [{ ...stock, availableQuantity: 9 }], groupedQuantities(rows), basket, [stock]);
    expect(shortage.lines).toEqual(basket);
    expect(shortage.rows.every(({ issue }) => issue?.startsWith("Not enough stock"))).toBe(true);
  });

  it("does not add unknown, out-of-stock, or unpublished lines but keeps other matches", () => {
    const rows = [matchQuickOrderLine(line(1, 1), []), matchQuickOrderLine(line(2, 1), [other]), matchQuickOrderLine(line(3, 1), [blade])];
    for (const failure of [undefined, { ...stock, id: other.id, availableQuantity: 0 }]) {
      const plan = planQuickOrder(rows, failure ? [stock, failure] : [stock], groupedQuantities(rows));
      expect(plan.lines).toEqual([{ variantId: blade.id, quantity: 1 }]);
      expect(plan.rows.map((row) => row.issue)).toEqual([
        "No blade matches this part number.", failure ? "Out of stock." : "This blade is no longer available to order.", undefined,
      ]);
    }
  });

  it("rejects only groups that exceed the basket limits", () => {
    const rows = [matchQuickOrderLine(line(1, 1), [other]), matchQuickOrderLine(line(2, 1), [blade])];
    const basket = [{ variantId: blade.id, quantity: 1 }, ...Array.from({ length: 99 }, (_, i) => ({ variantId: String(i), quantity: 1 }))];
    const plan = planQuickOrder(rows, [stock, { ...stock, id: other.id }], groupedQuantities(rows), basket, [stock]);
    expect(plan.lines).toHaveLength(100);
    expect(plan.lines[0]).toEqual({ variantId: blade.id, quantity: 2 });
    expect(plan.rows[0]?.issue).toMatch(/100 different blades/);
    const expensive = { ...stock, id: other.id, tierPrices: { oneToFour: MAX_ORDER_INTEGER, fiveToNine: 1995, tenPlus: 1750 } };
    const overLimit = planQuickOrder(rows, [stock, expensive], groupedQuantities(rows));
    expect(overLimit.rows[0]?.issue).toMatch(/checkout limit/);
    expect(overLimit.lines).toEqual([{ variantId: blade.id, quantity: 1 }]);
    const overQuantity = [matchQuickOrderLine(line(1, MAX_ORDER_INTEGER), [blade]), matchQuickOrderLine(line(2, 1), [blade])];
    expect(planQuickOrder(overQuantity, [stock], groupedQuantities(overQuantity)).rows[0]?.issue).toMatch(/combined quantity/);
  });
});
