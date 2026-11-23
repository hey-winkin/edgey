import type { SalesProduct } from "./report";

export const lowStockCoverWeeks = 2;

export function runningLowVariants(
  products: readonly Pick<SalesProduct, "id" | "available" | "units" | "stockFlag">[],
  stockOnOrder: ReadonlyMap<string, number>,
  days: number,
) {
  return products
    .filter(({ stockFlag }) => stockFlag === "low")
    .map(({ id, available, units }) => ({ id, supply: available + (stockOnOrder.get(id) ?? 0), units }))
    .filter(({ supply, units }) => supply * days < units * 7 * lowStockCoverWeeks)
    .sort((a, b) => a.supply * b.units - b.supply * a.units)
    .map(({ id }) => id);
}
