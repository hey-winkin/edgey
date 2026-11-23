import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { serviceClient } from "@/lib/supabase/service";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminSection } from "../../ui";
import { PriceTierFields } from "../price-tier-fields";
import { createDraftVariant } from "./actions";

export const metadata = { title: "Add draft variant" };

export default async function NewVariantPage() {
  await requireStaff("catalogue");
  const { data: products, error } = await serviceClient().from("products")
    .select("id, family_code, name").order("family_code");
  if (error) throw new Error("Could not load the product families.");

  return <>
    <AdminHeading title="Add draft variant" description="Add a distinct, unstocked SKU to an existing product family. It will not appear in the storefront." />
    <AdminLink href="/admin/catalogue">{staffDestinationLabels.productsAndPrices}</AdminLink>
    <AdminSection title="Variant details">
      <AdminForm action={createDraftVariant} submit="Create draft">
        <AdminField label="Product family">
          <select name="product" defaultValue="" required>
            <option value="" disabled>Choose a product family</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.family_code} · {product.name}</option>)}
          </select>
        </AdminField>
        <AdminField label="Edgey SKU"><input name="sku" placeholder="EDG-MIM-A45" maxLength={80} required /></AdminField>
        <AdminField label="Variant label (optional)"><input name="optionLabel" maxLength={160} /></AdminField>
        <PriceTierFields required />
      </AdminForm>
    </AdminSection>
  </>;
}
