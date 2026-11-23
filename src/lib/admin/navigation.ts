import type { StaffRole } from "./auth";
import { hasPurchasingRole, purchaseRoles } from "./roles";

export type StaffTask = "orders" | "requests" | "outOfStock";
export const stockOutOfStockHref = "/admin/stock?view=out-of-stock";
export const orderStockHref = "/admin/purchase-orders/new";
export const orderStockLabel = "Order stock";

export const staffDestinationLabels = {
  newSalesOrders: "New sales orders",
  customerEnquiries: "Customer enquiries",
  pastSalesOrders: "Past sales orders",
  purchaseOrders: "Purchase orders",
  suppliers: "Suppliers",
  bookInDelivery: "Book in a delivery",
  stock: "Stock",
  adjustStock: "Adjust stock",
  deliveryHistory: "Delivery history",
  customerDeliverySettings: "Customer delivery settings",
  businessDetails: "Business details",
  salesReports: "Sales reports",
  financeAndTradeAccounts: "Finance and trade accounts",
  shopPerformance: "Shop performance",
} as const;

const labels = staffDestinationLabels;

export function salesOrderReminder(count: number | null) {
  if (count === null) return labels.newSalesOrders;
  if (count === 0) return "No new sales orders";
  return count === 1 ? "1 new sales order" : `${count.toLocaleString("en-GB")} new sales orders`;
}

const areas: {
  title: string;
  orderStock?: true;
  links: { label: string; href: string; roles?: readonly StaffRole[]; task?: StaffTask; taskHref?: string }[];
}[] = [
  { title: "Sales orders", links: [
    { label: labels.newSalesOrders, href: "/admin/warehouse", roles: ["warehouse"], task: "orders" },
    { label: labels.customerEnquiries, href: "/admin/requests", task: "requests" },
    { label: labels.pastSalesOrders, href: "/admin/warehouse?view=history", roles: ["warehouse"] },
  ] },
  { title: "Purchasing", orderStock: true, links: [
    { label: labels.purchaseOrders, href: "/admin/purchase-orders", roles: ["warehouse", ...purchaseRoles] },
    { label: labels.suppliers, href: "/admin/purchase-orders/suppliers", roles: purchaseRoles },
    { label: labels.stock, href: "/admin/catalogue", roles: purchaseRoles },
    { label: labels.bookInDelivery, href: "/admin/stock/receive", roles: ["warehouse"] },
    { label: labels.adjustStock, href: "/admin/stock", roles: ["warehouse"], task: "outOfStock", taskHref: stockOutOfStockHref },
    { label: labels.deliveryHistory, href: "/admin/stock/deliveries", roles: ["warehouse", ...purchaseRoles] },
  ] },
  { title: "Admin", links: [
    { label: labels.customerDeliverySettings, href: "/admin/delivery", roles: ["warehouse"] },
    { label: labels.businessDetails, href: "/admin/purchase-orders/settings", roles: purchaseRoles },
    { label: labels.salesReports, href: "/admin/sales" },
    { label: labels.financeAndTradeAccounts, href: "/admin/finance", roles: ["finance"] },
    { label: labels.shopPerformance, href: "/admin/commercial", roles: ["warehouse"] },
  ] },
];

export function staffAreas(roles: readonly StaffRole[]) {
  return areas.map(({ title, links, orderStock }) => ({
    title,
    orderStock: orderStock && hasPurchasingRole(roles),
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
