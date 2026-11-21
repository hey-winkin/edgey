import type { Database } from "@/lib/supabase/database.types";

type StaffRole = Database["public"]["Enums"]["staff_role"];

const areas: {
  title: string;
  links: { label: string; href: string; roles?: StaffRole[] }[];
}[] = [
  { title: "Work queues", links: [
    { label: "Staff desk", href: "/admin" },
    { label: "Requests", href: "/admin/requests" },
    { label: "Pick and dispatch", href: "/admin/warehouse", roles: ["warehouse"] },
    { label: "Stock", href: "/admin/stock", roles: ["warehouse"] },
  ] },
  { title: "Catalogue & delivery", links: [
    { label: "Catalogue", href: "/admin/catalogue", roles: ["catalogue", "finance"] },
    { label: "Delivery settings", href: "/admin/delivery", roles: ["warehouse"] },
  ] },
  { title: "Reporting & finance", links: [
    { label: "Sales", href: "/admin/sales" },
    { label: "Commercial measures", href: "/admin/commercial", roles: ["warehouse"] },
    { label: "Finance", href: "/admin/finance", roles: ["finance"] },
  ] },
];

export function staffNavigation(roles: readonly StaffRole[]) {
  return areas.map(({ title, links }) => ({
    title,
    links: links.filter(({ roles: required }) => !required || required.some((role) => roles.includes(role)))
      .map(({ label, href }) => ({ label, href })),
  }));
}
