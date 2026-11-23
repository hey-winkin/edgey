import type { Metadata } from "next";
import { AdminHeading, AdminLink, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  await requireStaff("catalogue", "finance");

  return (
    <>
      <AdminHeading title="Add supplier" eyebrow="Purchase orders"
        description="Only the supplier name is required. Internal notes do not appear on purchase orders." />
      <nav className="flex flex-wrap items-center gap-4" aria-label="Supplier links">
        <AdminLink href="/admin/purchase-orders">Back to purchase orders</AdminLink>
        <AdminLink href="/admin/purchase-orders/suppliers">Supplier register</AdminLink>
      </nav>
      <AdminSection title="Supplier details"><SupplierForm /></AdminSection>
    </>
  );
}
