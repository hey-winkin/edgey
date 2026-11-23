import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminHeading, AdminLink, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { SupplierForm } from "../supplier-form";

export const metadata: Metadata = { title: "Edit supplier" };

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await requireStaff("catalogue", "finance");
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const { data, error } = await db.from("staff_suppliers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Couldn’t load the supplier.");
  if (!data) notFound();

  return (
    <>
      <AdminHeading title={data.name} eyebrow="Edit supplier"
        description="Contact details can appear on purchase orders. Internal notes are for staff only." />
      <nav className="flex flex-wrap items-center gap-4" aria-label="Supplier links">
        <AdminLink href="/admin/purchase-orders">Back to purchase orders</AdminLink>
        <AdminLink href="/admin/purchase-orders/suppliers">Supplier register</AdminLink>
      </nav>
      <AdminSection title="Supplier details"><SupplierForm supplier={data} /></AdminSection>
    </>
  );
}
