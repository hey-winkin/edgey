import { expect, test } from "vitest";
import { salesOrderReminder, staffAreas, staffLocation, staffNavigation } from "@/lib/admin/navigation";
import { hasPurchasingRole } from "@/lib/admin/roles";

test.each([
  [[], false],
  [["warehouse"], false],
  [["catalogue"], true],
  [["finance"], true],
  [["warehouse", "catalogue"], true],
  [["warehouse", "finance"], true],
] as const)("exposes stock ordering for the existing purchasing roles (%j)", (roles, allowed) => {
  expect(hasPurchasingRole(roles)).toBe(allowed);
});

test.each([
  [0, "No new sales orders"],
  [1, "1 new sales order"],
  [4, "4 new sales orders"],
  [1000, "1,000 new sales orders"],
  [null, "New sales orders"],
] as const)("formats the sales order reminder for %s", (count, label) => {
  expect(salesOrderReminder(count)).toBe(label);
});

test("staff destinations are ordered by job without exposing their role or task metadata", () => {
  expect(staffNavigation(["catalogue", "finance", "warehouse"])).toEqual([
    { title: "Sales orders", links: [
      { label: "New sales orders", href: "/admin/warehouse" },
      { label: "Customer enquiries", href: "/admin/requests" },
      { label: "Past sales orders", href: "/admin/warehouse?view=history" },
    ] },
    { title: "Purchasing", links: [
      { label: "Purchase orders", href: "/admin/purchase-orders" },
      { label: "Suppliers", href: "/admin/purchase-orders/suppliers" },
      { label: "Stock", href: "/admin/catalogue" },
      { label: "Book in a delivery", href: "/admin/stock/receive" },
      { label: "Adjust stock", href: "/admin/stock" },
      { label: "Delivery history", href: "/admin/stock/deliveries" },
    ] },
    { title: "Admin", links: [
      { label: "Customer delivery settings", href: "/admin/delivery" },
      { label: "Business details", href: "/admin/purchase-orders/settings" },
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
    "Sales orders": ["New sales orders", "Customer enquiries", "Past sales orders"],
    Purchasing: ["Purchase orders", "Book in a delivery", "Adjust stock", "Delivery history"],
    Admin: ["Customer delivery settings", "Sales reports", "Shop performance"],
  });
  expect(labels(["catalogue"])).toEqual({
    "Sales orders": ["Customer enquiries"], Purchasing: ["Purchase orders", "Suppliers", "Stock", "Delivery history"], Admin: ["Business details", "Sales reports"],
  });
  expect(labels(["finance"])).toEqual({
    "Sales orders": ["Customer enquiries"], Purchasing: ["Purchase orders", "Suppliers", "Stock", "Delivery history"], Admin: ["Business details", "Sales reports", "Finance and trade accounts"],
  });
  expect(labels([])).toEqual({ "Sales orders": ["Customer enquiries"], Admin: ["Sales reports"] });
});

test("the trial follow-up shortcut is on the desk for trial staff without changing the fold-down menu", () => {
  for (const role of ["warehouse", "catalogue", "finance"] as const) {
    const desk = staffAreas([role]).find(({ title }) => title === "Sales orders")!;
    expect(desk.links.some(({ task }) => task === "trialFollowUps")).toBe(role !== "finance");
    expect(staffNavigation([role]).flatMap(({ links }) => links).map(({ label }) => label)).not.toContain("Trial follow-ups");
  }
});

test("history and record paths select exactly one permitted destination", () => {
  const groups = staffNavigation(["warehouse", "finance"]);
  expect(staffLocation(groups, "/admin/warehouse", "history"))
    .toEqual({ title: "Sales orders", href: "/admin/warehouse?view=history", state: "page" });
  expect(staffLocation(groups, "/admin/warehouse/id/print", null))
    .toEqual({ title: "Sales orders", href: "/admin/warehouse", state: "location" });
  expect(staffLocation(groups, "/admin/stock/receive", null))
    .toEqual({ title: "Purchasing", href: "/admin/stock/receive", state: "page" });
  expect(staffLocation(groups, "/admin/catalogue/id", null))
    .toEqual({ title: "Purchasing", href: "/admin/catalogue", state: "location" });
  expect(staffLocation(groups, "/admin/stock", "out-of-stock"))
    .toEqual({ title: "Purchasing", href: "/admin/stock", state: "page" });
  expect(staffLocation(groups, "/admin/stock/deliveries/id", null))
    .toEqual({ title: "Purchasing", href: "/admin/stock/deliveries", state: "location" });
  expect(staffLocation(groups, "/admin/purchase-orders/id/print", null))
    .toEqual({ title: "Purchasing", href: "/admin/purchase-orders", state: "location" });
  expect(staffLocation(groups, "/admin/purchase-orders/settings", null))
    .toEqual({ title: "Admin", href: "/admin/purchase-orders/settings", state: "page" });
  expect(staffLocation(groups, "/admin/purchase-orders/suppliers/id", null))
    .toEqual({ title: "Purchasing", href: "/admin/purchase-orders/suppliers", state: "location" });
  expect(staffLocation(groups, "/admin/finance/accounts/id", null))
    .toEqual({ title: "Admin", href: "/admin/finance", state: "location" });
  expect(staffLocation(groups, "/admin", null)).toBeNull();
  expect(staffLocation(staffNavigation(["catalogue"]), "/admin/warehouse/id", null)).toBeNull();
});
