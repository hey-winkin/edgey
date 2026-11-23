import { expect, test } from "vitest";
import { staffNavigation } from "@/lib/admin/navigation";

test("staff links union the assigned roles without exposing role metadata", () => {
  const links = staffNavigation(["catalogue", "finance", "warehouse"]).flatMap(({ links }) => links);
  expect(links.map(({ href }) => href)).toEqual([
    "/admin", "/admin/requests", "/admin/warehouse", "/admin/stock",
    "/admin/stock/receive", "/admin/stock/deliveries", "/admin/catalogue",
    "/admin/delivery", "/admin/sales", "/admin/commercial", "/admin/finance",
  ]);
  expect(links.every((link) => Object.keys(link).length === 2)).toBe(true);
});
