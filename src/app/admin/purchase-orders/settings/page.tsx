import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";
import { savePurchaseBuyerSettings } from "./actions";

export const metadata: Metadata = { title: staffDestinationLabels.businessDetails };

export default async function PurchaseBuyerSettingsPage() {
  const { db } = await requireStaff("catalogue", "finance");
  const { data, error } = await db.from("staff_purchase_buyer_settings")
    .select("name,address,email,company_number,vat_number").eq("id", true).maybeSingle();
  if (error && stockSchemaUnavailable(error)) notFound();
  if (error) throw new Error("Couldn’t load buyer details.");

  return (
    <>
      <AdminHeading title={staffDestinationLabels.businessDetails}
        description="Set the name, address and registration details shown on supplier copies. Blank fields are omitted." />
      <AdminLink href="/admin/purchase-orders">Back to purchase orders</AdminLink>
      <AdminSection title="Details for supplier copies">
        <AdminForm action={savePurchaseBuyerSettings} submit="Save buyer details" preserveOnError>
          <div className="admin-grid">
            <AdminField label="Business name">
              <input name="name" defaultValue={data?.name ?? ""} maxLength={200} />
            </AdminField>
            <AdminField label="Email">
              <input name="email" type="email" defaultValue={data?.email ?? ""} maxLength={254} />
            </AdminField>
            <AdminField label="Company number">
              <input name="company_number" defaultValue={data?.company_number ?? ""} maxLength={80} />
            </AdminField>
            <AdminField label="VAT number">
              <input name="vat_number" defaultValue={data?.vat_number ?? ""} maxLength={80} />
            </AdminField>
          </div>
          <AdminField label="Address">
            <textarea name="address" rows={4} defaultValue={data?.address ?? ""} maxLength={1000} />
          </AdminField>
        </AdminForm>
      </AdminSection>
    </>
  );
}
