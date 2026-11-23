import { AdminField, AdminForm } from "@/app/admin/ui";
import { purchaseDocumentCurrencies } from "@/lib/admin/purchase-document";
import type { Database } from "@/lib/supabase/database.types";
import { savePurchaseSupplier } from "./actions";

type Supplier = Database["public"]["Tables"]["staff_suppliers"]["Row"];

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  return (
    <AdminForm action={savePurchaseSupplier.bind(null, supplier?.id ?? null)} submit="Save supplier" preserveOnError>
      <div className="admin-grid">
        <AdminField label="Supplier name">
          <input name="name" defaultValue={supplier?.name} maxLength={200} required />
        </AdminField>
        <AdminField label="Contact name">
          <input name="contact_name" defaultValue={supplier?.contact_name ?? ""} maxLength={200} />
        </AdminField>
        <AdminField label="Email">
          <input name="email" type="email" defaultValue={supplier?.email ?? ""} maxLength={254} />
        </AdminField>
        <AdminField label="Phone">
          <input name="phone" type="tel" defaultValue={supplier?.phone ?? ""} maxLength={80} />
        </AdminField>
        <AdminField label="Default currency">
          <select name="default_currency" defaultValue={supplier?.default_currency ?? ""}>
            <option value="">No default</option>
            {purchaseDocumentCurrencies.map((currency) => <option key={currency}>{currency}</option>)}
          </select>
        </AdminField>
        <AdminField label="Lead time (days)">
          <input name="lead_time_days" type="number" min={0} max={2_147_483_647} step={1}
            defaultValue={supplier?.lead_time_days ?? ""} />
        </AdminField>
      </div>
      <AdminField label="Address">
        <textarea name="address" rows={3} defaultValue={supplier?.address ?? ""} maxLength={1000} />
      </AdminField>
      <AdminField label="Internal notes">
        <textarea name="notes" rows={3} defaultValue={supplier?.notes ?? ""} maxLength={2000} />
      </AdminField>
    </AdminForm>
  );
}
