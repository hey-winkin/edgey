import type { Database } from "@/lib/supabase/database.types";

type StaffRole = Database["public"]["Enums"]["staff_role"];

export type StaffTask = "orders" | "requests" | "outOfStock";
export const stockOutOfStockHref = "/admin/stock?view=out-of-stock";

const areas: {
  title: string;
  links: { label: string; href: string; roles?: StaffRole[]; task?: StaffTask; taskHref?: string }[];
}[] = [
  { title: "Orders", links: [
    { label: "Pick and dispatch", href: "/admin/warehouse", roles: ["warehouse"], task: "orders" },
    { label: "Customer requests", href: "/admin/requests", task: "requests" },
    { label: "Order history", href: "/admin/warehouse?view=history", roles: ["warehouse"] },
  ] },
  { title: "Purchases", links: [
    { label: "Purchase orders", href: "/admin/purchase-orders", roles: ["warehouse", "catalogue", "finance"] },
    { label: "Suppliers", href: "/admin/purchase-orders/suppliers", roles: ["catalogue", "finance"] },
    { label: "Receive a delivery", href: "/admin/stock/receive", roles: ["warehouse"] },
    { label: "Stock and adjustments", href: "/admin/stock", roles: ["warehouse"], task: "outOfStock", taskHref: stockOutOfStockHref },
    { label: "Delivery history", href: "/admin/stock/deliveries", roles: ["warehouse", "catalogue", "finance"] },
  ] },
  { title: "Admin", links: [
    { label: "Catalogue", href: "/admin/catalogue", roles: ["catalogue", "finance"] },
    { label: "Delivery settings", href: "/admin/delivery", roles: ["warehouse"] },
    { label: "Sales reports", href: "/admin/sales" },
    { label: "Finance and trade accounts", href: "/admin/finance", roles: ["finance"] },
    { label: "Shop performance", href: "/admin/commercial", roles: ["warehouse"] },
  ] },
];

export function staffAreas(roles: readonly StaffRole[]) {
  return areas.map(({ title, links }) => ({
    title,
    links: links.filter(({ roles: required }) => !required || required.some((role) => roles.includes(role)))
      .map(({ label, href, task, taskHref }) => ({ label, href, task, taskHref })),
  })).filter(({ links }) => links.length > 0);
}

export function staffNavigation(roles: readonly StaffRole[]) {
  return staffAreas(roles).map(({ title, links }) => ({
    title, links: links.map(({ label, href }) => ({ label, href })),
  }));
}

export function staffLocation(groups: ReturnType<typeof staffNavigation>, pathname: string, view: string | null) {
  const locations = groups.flatMap(({ title, links }) => links.map(({ href }) => ({ title, href })));
  const exact = locations.find(({ href }) => href === `${pathname}?view=${view}`) ??
    locations.find(({ href }) => href === pathname);
  if (exact) return { ...exact, state: "page" as const };

  const parent = locations.reduce<typeof locations[number] | undefined>((closest, entry) =>
    pathname.startsWith(entry.href + "/") && entry.href.length > (closest?.href.length ?? 0) ? entry : closest,
  undefined);
  return parent ? { ...parent, state: "location" as const } : null;
}
