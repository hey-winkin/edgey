import type { Metadata } from "next";
import Link from "next/link";
import { AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels as labels } from "@/lib/admin/navigation";
import { stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";

export const metadata: Metadata = { title: labels.suppliers };

export default async function SuppliersPage() {
  const { db } = await requireStaff("catalogue", "finance");
  const { data, error } = await db.from("staff_suppliers")
    .select("id,name,contact_name,email,default_currency,lead_time_days").order("name").order("id");
  if (error && !stockSchemaUnavailable(error)) throw new Error("Couldn’t load suppliers.");

  return (
    <>
      <AdminHeading title={labels.suppliers} eyebrow={labels.purchaseOrders}
        description="Manage supplier contacts, default currencies and lead times for purchase orders." />
      <nav className="flex flex-wrap items-center gap-4" aria-label="Supplier controls">
        <AdminLink href="/admin/purchase-orders">Back to purchase orders</AdminLink>
        {!error && <Link className="primary" href="/admin/purchase-orders/suppliers/new">Add supplier</Link>}
      </nav>
      <AdminSection title="Supplier register">
        {error ? <AdminNotice>The supplier register is not available yet.</AdminNotice> : data.length ? (
          <AdminTable headers={["Supplier", "Contact", "Default currency", "Lead time (days)"]} label="Suppliers">
            {data.map((supplier) => (
              <tr key={supplier.id}>
                <td><AdminLink href={`/admin/purchase-orders/suppliers/${supplier.id}`}>{supplier.name}</AdminLink></td>
                <td>
                  {supplier.contact_name && <div>{supplier.contact_name}</div>}
                  {supplier.email && <div className="admin-mono">{supplier.email}</div>}
                  {!supplier.contact_name && !supplier.email && "—"}
                </td>
                <td className="admin-mono">{supplier.default_currency ?? "—"}</td>
                <td className="admin-mono">{supplier.lead_time_days ?? "—"}</td>
              </tr>
            ))}
          </AdminTable>
        ) : <AdminNotice>No suppliers yet. Add one before issuing a purchase order.</AdminNotice>}
      </AdminSection>
    </>
  );
}
