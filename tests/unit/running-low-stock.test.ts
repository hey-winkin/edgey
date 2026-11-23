import { expect, test } from "vitest";
import { runningLowVariants } from "@/lib/sales/stock-cover";
import type { SalesProduct } from "@/lib/sales/report";

test("ranks below-band blades by cover after outstanding quantities and excludes no-sales flags", () => {
  const products: Pick<SalesProduct, "id" | "available" | "units" | "stockFlag">[] = [
    { id: "fewer", available: 1, units: 30, stockFlag: "low" },
    { id: "more", available: 8, units: 30, stockFlag: "low" },
    { id: "just-below", available: 10, units: 30, stockFlag: "low" },
    { id: "exactly-two-weeks", available: 7, units: 30, stockFlag: "low" },
    { id: "covered-by-purchase", available: 0, units: 30, stockFlag: "low" },
    { id: "never-sold", available: 0, units: 0, stockFlag: "never_sold" },
    { id: "quiet", available: 0, units: 0, stockFlag: "no_sales" },
    { id: "healthy", available: 14, units: 30, stockFlag: null },
  ];
  const inbound = new Map([["fewer", 2], ["just-below", 3], ["exactly-two-weeks", 7], ["covered-by-purchase", 30]]);
  expect(runningLowVariants(products, inbound, 30)).toEqual(["fewer", "more", "just-below"]);
});
