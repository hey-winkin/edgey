import { MAX_BASKET_LINES, MAX_ORDER_INTEGER } from "@/lib/checkout/validation";
import { calculateBasket, priceLine, STANDARD_DELIVERY_QUOTE, type CommerceVariant, type LineRequest } from "@/lib/commerce";

export const MAX_QUICK_ORDER_LINES = 25;
export const MAX_QUICK_ORDER_INPUT = 4_000;
export const MAX_PART_CODE = 80;
export const quantityError = "Enter a positive whole quantity within the basket limit.";

export type OrderLine = { number: number; input: string; code: string; quantity: number };
export type ParsedLine = OrderLine | { number: number; input: string; issue: string };
export type Blade = { id: string; sku: string; slug: string; name: string; optionLabel: string | null; tool: string | null };
export type CheckedLine = OrderLine & {
  candidates: Blade[];
  chosen: boolean;
  blade?: Blade;
  price?: { unit: number; minimum: number; combinedQuantity: number };
  issue?: string;
};
export type ResultLine = CheckedLine | Extract<ParsedLine, { issue: string }>;
export type ReadyLine = CheckedLine & { blade: Blade };

export function isReady(line: ResultLine): line is ReadyLine {
  return "blade" in line && !!line.blade && !line.issue;
}

function unquote(value: string) {
  return value.trim().replace(/^"([^"]*)"$/, "$1").trim();
}

export function validPartCode(code: string) {
  return code.length <= MAX_PART_CODE && /[\p{L}\p{N}]/u.test(code) && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(code);
}

export function parseQuickOrder(text: string): { lines: ParsedLine[]; issue?: string } {
  if (text.length > MAX_QUICK_ORDER_INPUT) {
    return { lines: [], issue: `Enter no more than ${MAX_QUICK_ORDER_INPUT.toLocaleString("en-GB")} characters at a time.` };
  }
  const lines = text.split(/\r\n?|\n/).flatMap((raw, index): ParsedLine[] => {
    const input = raw.trim();
    if (!input) return [];
    const number = index + 1;
    const cells = input.includes("\t") ? input.split("\t") : input.includes(",") ? input.split(",") :
      input.match(/^(.+?)\s+(\S+)$/u)?.slice(1);
    if (cells?.length !== 2) return [{ number, input, issue: "Enter a part number and quantity on this line." }];
    const [code = "", count = ""] = cells.map(unquote);
    if (!validPartCode(code)) return [{ number, input, issue: "Enter a part number of up to 80 characters." }];
    const quantity = Number(count);
    if (!/^\d+$/.test(count) || quantity < 1 || quantity > MAX_ORDER_INTEGER) {
      return [{ number, input, issue: quantityError }];
    }
    return [{ number, input, code, quantity }];
  });
  if (!lines.length) return { lines, issue: "Enter at least one part number and quantity." };
  if (lines.length > MAX_QUICK_ORDER_LINES) return { lines: [], issue: `Check up to ${MAX_QUICK_ORDER_LINES} lines at a time.` };
  return { lines };
}

export function choiceField({ number, code }: OrderLine) {
  return `choice:${number}:${code}`;
}

export function matchQuickOrderLine(line: OrderLine, candidates: Blade[], choice?: string, expected?: string): CheckedLine {
  const chosen = !!choice && candidates.some(({ id }) => id === choice);
  const blade = chosen ? candidates.find(({ id }) => id === choice) :
    candidates.length === 1 ? candidates[0] : undefined;
  const issue = (choice && !chosen) || (expected && blade?.id !== expected) ? "The match changed. Check this line again." :
    !candidates.length ? "No blade matches this part number." :
      !blade ? "This code matches more than one blade. Choose a blade, then check again." : undefined;
  return { ...line, candidates, chosen, blade: issue ? undefined : blade, issue };
}

export function groupedQuantities(rows: ResultLine[]) {
  const groups = new Map<string, number>();
  for (const row of rows) {
    if (isReady(row)) groups.set(row.blade.id, (groups.get(row.blade.id) ?? 0) + row.quantity);
  }
  return groups;
}

export function planQuickOrder(
  rows: ResultLine[], stock: readonly CommerceVariant[], groups: Map<string, number>,
  basket: readonly LineRequest[] = [], basketStock: readonly CommerceVariant[] = [],
) {
  const quantities = new Map(basket.map(({ variantId, quantity }) => [variantId, quantity]));
  const byId = new Map(stock.map((variant) => [variant.id, variant]));
  const priced = new Map(basketStock.map((variant) => [variant.id, variant]));
  const decisions = new Map<string, Pick<CheckedLine, "price" | "issue">>();
  for (const [id, requested] of groups) {
    const existing = quantities.get(id);
    const quantity = requested + (existing ?? 0);
    const variant = byId.get(id);
    const price = variant && quantity <= MAX_ORDER_INTEGER ? priceLine(variant, quantity) : null;
    let issue = !variant ? "This blade is no longer available to order." :
      quantity > MAX_ORDER_INTEGER ? "The combined quantity exceeds the basket limit." :
        !price?.ok ? "This blade can’t be ordered at this quantity." :
          !variant.availableQuantity ? "Out of stock." :
            variant.availableQuantity < quantity ? "In stock, but not enough for the combined quantity. Try fewer blades." :
              existing === undefined && quantities.size >= MAX_BASKET_LINES ? `Your basket has reached its limit of ${MAX_BASKET_LINES} different blades.` : undefined;
    if (!issue && variant) {
      const previous = priced.get(id);
      quantities.set(id, quantity);
      priced.set(id, variant);
      if (!withinBasketTotal(quantities, priced)) {
        issue = "Adding this quantity would exceed the checkout limit.";
        if (existing === undefined) quantities.delete(id);
        else quantities.set(id, existing);
        if (previous) priced.set(id, previous);
        else priced.delete(id);
      }
    }
    decisions.set(id, {
      issue,
      price: price?.ok ? { unit: price.value.unitNetPence, minimum: price.value.tierMinimumQuantity, combinedQuantity: quantity } : undefined,
    });
  }
  return {
    rows: rows.map((row): ResultLine => isReady(row) ? { ...row, ...decisions.get(row.blade.id) } : row),
    lines: [...quantities].map(([variantId, quantity]) => ({ variantId, quantity })),
  };
}

function withinBasketTotal(quantities: Map<string, number>, stock: Map<string, CommerceVariant>) {
  const available = [...quantities].flatMap(([variantId, quantity]) => {
    const quoted = Math.min(quantity, stock.get(variantId)?.availableQuantity ?? 0);
    return quoted ? [{ variantId, quantity: quoted }] : [];
  });
  if (!available.length) return true;
  const result = calculateBasket({ lines: available, variants: [...stock.values()], deliveryQuote: STANDARD_DELIVERY_QUOTE });
  return result.ok && result.value.totalGrossPence <= MAX_ORDER_INTEGER;
}
