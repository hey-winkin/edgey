import { expect, test } from "vitest";
import { staffLocation, staffNavigation } from "@/lib/admin/navigation";

test("staff destinations are ordered by job without exposing their role or task metadata", () => {
  expect(staffNavigation(["catalogue", "finance", "warehouse"])).toEqual([
    { title: "Orders", links: [
      { label: "Pick and dispatch", href: "/admin/warehouse" },
      { label: "Customer requests", href: "/admin/requests" },
      { label: "Order history and returns", href: "/admin/warehouse?view=history" },
    ] },
    { title: "Purchases", links: [
      { label: "Receive a delivery", href: "/admin/stock/receive" },
      { label: "Stock and adjustments", href: "/admin/stock" },
      { label: "Delivery history", href: "/admin/stock/deliveries" },
    ] },
    { title: "Admin", links: [
      { label: "Catalogue", href: "/admin/catalogue" },
      { label: "Delivery settings", href: "/admin/delivery" },
      { label: "Sales reports", href: "/admin/sales" },
      { label: "Finance and trade accounts", href: "/admin/finance" },
      { label: "Shop performance", href: "/admin/commercial" },
    ] },
  ]);
});

test("groups retain the route permissions and suppress an empty group", () => {
  const labels = (roles: Parameters<typeof staffNavigation>[0]) =>
    Object.fromEntries(staffNavigation(roles).map(({ title, links }) => [title, links.map(({ label }) => label)]));
  expect(labels(["warehouse"])).toEqual({
    Orders: ["Pick and dispatch", "Customer requests", "Order history and returns"],
    Purchases: ["Receive a delivery", "Stock and adjustments", "Delivery history"],
    Admin: ["Delivery settings", "Sales reports", "Shop performance"],
  });
  expect(labels(["catalogue"])).toEqual({
    Orders: ["Customer requests"], Purchases: ["Delivery history"], Admin: ["Catalogue", "Sales reports"],
  });
  expect(labels(["finance"])).toEqual({
    Orders: ["Customer requests"], Purchases: ["Delivery history"], Admin: ["Catalogue", "Sales reports", "Finance and trade accounts"],
  });
  expect(labels([])).toEqual({ Orders: ["Customer requests"], Admin: ["Sales reports"] });
});

test("history and record paths select exactly one permitted destination", () => {
  const groups = staffNavigation(["warehouse", "finance"]);
  expect(staffLocation(groups, "/admin/warehouse", "history"))
    .toEqual({ title: "Orders", href: "/admin/warehouse?view=history", state: "page" });
  expect(staffLocation(groups, "/admin/warehouse/id/print", null))
    .toEqual({ title: "Orders", href: "/admin/warehouse", state: "location" });
  expect(staffLocation(groups, "/admin/stock/receive", null))
    .toEqual({ title: "Purchases", href: "/admin/stock/receive", state: "page" });
  expect(staffLocation(groups, "/admin/stock/deliveries/id", null))
    .toEqual({ title: "Purchases", href: "/admin/stock/deliveries", state: "location" });
  expect(staffLocation(groups, "/admin/finance/accounts/id", null))
    .toEqual({ title: "Admin", href: "/admin/finance", state: "location" });
  expect(staffLocation(groups, "/admin", null)).toBeNull();
  expect(staffLocation(staffNavigation(["catalogue"]), "/admin/warehouse/id", null)).toBeNull();
});
