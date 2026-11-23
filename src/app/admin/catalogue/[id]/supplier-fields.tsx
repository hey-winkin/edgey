"use client";

import { Fragment, useState } from "react";
import { AdminField, AdminLink } from "@/app/admin/ui";
import { maxSupplierPartNumberLength } from "@/lib/admin/variant-suppliers";
import { sellingFormId } from "./editor-form";
import styles from "./editor.module.css";

type SupplierOption = { id: string; name: string };
type SupplierAssociation = {
  supplier_id: string;
  supplier_part_number: string | null;
  is_usual: boolean;
};

export function SupplierFields({ suppliers, associations, legacyName, legacyPart }: {
  suppliers: SupplierOption[];
  associations: SupplierAssociation[];
  legacyName: string | null;
  legacyPart: string | null;
}) {
  const usual = associations.find(({ is_usual }) => is_usual);
  const [supplierId, setSupplierId] = useState(usual?.supplier_id ?? "");
  const [partDrafts, setPartDrafts] = useState<Record<string, string>>({});
  const supplierNames = new Map(suppliers.map(({ id, name }) => [id, name]));
  const nameCounts = new Map<string, number>();
  for (const { name } of suppliers) {
    const key = name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const originalPart = associations.find(({ supplier_id }) => supplier_id === supplierId)?.supplier_part_number ?? "";
  const alternatives = associations.filter(({ supplier_id }) => supplier_id !== supplierId);

  return (
    <section aria-labelledby="variant-supplier-heading" className={styles.supplierSection}>
      <h3 id="variant-supplier-heading">Supplier details</h3>
      <p className="admin-muted">The usual supplier can be suggested on purchase orders. Part numbers belong to the supplier, not to every order for this SKU.</p>
      <div className={styles.specGrid}>
        <AdminField label="Usual supplier">
          <select form={sellingFormId} name="usual_supplier_id" value={supplierId}
            onChange={(event) => setSupplierId(event.currentTarget.value)}>
            <option value="">No usual supplier</option>
            {suppliers.map(({ id, name }) => <option key={id} value={id}>
              {(nameCounts.get(name.trim().toLowerCase()) ?? 0) > 1 ? `${name} (${id.slice(0, 8)})` : name}
            </option>)}
          </select>
        </AdminField>
        {supplierId && <AdminField label="Part number for usual supplier">
          <input form={sellingFormId} name="usual_supplier_part_number" maxLength={maxSupplierPartNumberLength}
            value={partDrafts[supplierId] ?? originalPart}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setPartDrafts((drafts) => ({ ...drafts, [supplierId]: value }));
            }} />
        </AdminField>}
      </div>
      <input form={sellingFormId} type="hidden" name="usual_supplier_part_for" value={supplierId} />
      <input form={sellingFormId} type="hidden" name="usual_supplier_part_original" value={originalPart} />
      <noscript><p className="admin-muted">
        Save a new usual supplier selection before entering its part number.
      </p></noscript>
      <AdminLink href="/admin/purchase-orders/suppliers">View the Suppliers register</AdminLink>
      {alternatives.length > 0 && (
        <details>
          <summary>Other saved supplier details</summary>
          <dl className="admin-spec">
            {alternatives.map(({ supplier_id, supplier_part_number }) => (
              <Fragment key={supplier_id}>
                <dt>{supplierNames.get(supplier_id) ?? "Registered supplier"}</dt>
                <dd>{supplier_part_number ?? "No part number recorded"}</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}
      {(legacyName !== null || legacyPart !== null) && (
        <>
          <h4>Legacy supplier details</h4>
          <p className="admin-muted">These saved details are read-only and aren’t used to fill purchase orders.</p>
          <dl className="admin-spec">
            {legacyName !== null && <><dt>Supplier name</dt><dd className="admin-preserve-lines">{legacyName}</dd></>}
            {legacyPart !== null && <><dt>Supplier part number</dt><dd className="admin-preserve-lines">{legacyPart}</dd></>}
          </dl>
        </>
      )}
    </section>
  );
}
