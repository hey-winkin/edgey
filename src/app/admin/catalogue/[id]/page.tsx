import { notFound } from "next/navigation";
import Image from "next/image";
import { resolveCatalogueMedia } from "@/lib/catalogue/media";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection } from "@/app/admin/ui";
import { requireStaff } from "@/lib/admin/auth";
import { catalogueId, getAdminCataloguePricing, getAdminCatalogueVariant, variantReviewStatus } from "@/lib/admin/catalogue";
import { displayState, displayTimestamp } from "@/lib/admin/format";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import type { TierPrices } from "@/lib/admin/price-tiers";
import { getCurrentStaffCost } from "@/lib/admin/stock-cost-data";
import { editCatalogueVariant } from "./actions";
import { archiveVariant } from "./cost-actions";
import { EditorForm, EditorWorkspace, SellingDraftNotice, SellingFields, sellingFormId } from "./editor-form";
import { VariantCost } from "./variant-cost";
import { VariantPricing } from "./variant-pricing";
import styles from "./editor.module.css";

const sections = [
  ["overview", "Overview & publication"],
  ["pricing", "Pricing & costs"],
  ["specifications", "Specifications & materials"],
  ["compatibility", "Compatibility & approval"],
  ["family", "Family details"],
] as const;

function tierPrices({ price_1_4_pence, price_5_9_pence, price_10_plus_pence }: TierPrices): TierPrices {
  return { price_1_4_pence, price_5_9_pence, price_10_plus_pence };
}

function ReviewFields({ consequence, id }: { consequence: string; id: string }) {
  return (
    <>
      <div className={styles.reviewDecision}>
        <AdminField label="Review decision">
          <select name="operation" required defaultValue="">
            <option value="" disabled>Select</option>
            <option value="approve">Approve</option>
            <option value="reject">Reject</option>
          </select>
        </AdminField>
        <div className={styles.reviewConfirmation}>
          <p id={id}>{consequence}</p>
          <label className="admin-check">
            <input type="checkbox" name="confirmReject" value="yes" aria-describedby={id} />
            <span>I confirm this rejection</span>
          </label>
        </div>
      </div>
      <AdminField label="Evidence source">
        <input name="source" required maxLength={240} />
      </AdminField>
      <AdminField label="Evidence note">
        <textarea name="note" required maxLength={2000} rows={3} />
      </AdminField>
    </>
  );
}

function ReviewRecord({
  state, source, note, url, date, reviewer,
}: {
  state: string;
  source: string | null;
  note: string | null;
  url?: string | null;
  date: string | null;
  reviewer: string | null;
}) {
  return (
    <dl className="admin-spec">
      <dt>Status</dt><dd>{state}</dd>
      {source && <><dt>Recorded source</dt><dd>{source}</dd></>}
      {note && <><dt>Recorded note</dt><dd>{note}</dd></>}
      {url && <><dt>Recorded evidence URL</dt><dd>{url}</dd></>}
      {date && <><dt>Reviewed</dt><dd><time dateTime={date}>{displayTimestamp(date)}</time></dd></>}
      {reviewer && <><dt>Reviewer</dt><dd className="admin-mono">{reviewer}</dd></>}
    </dl>
  );
}

export default async function CatalogueVariantPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, roles } = await requireStaff("catalogue", "finance");
  const { id } = await params;
  if (!catalogueId.test(id)) notFound();
  if (!roles.includes("catalogue")) {
    const [variant, cost] = await Promise.all([getAdminCataloguePricing(id), getCurrentStaffCost(db, roles, id)]);
    if (!variant?.products) notFound();
    return (
      <div className={styles.editor}>
        <AdminLink href="/admin/catalogue">{staffDestinationLabels.productsAndPrices}</AdminLink>
        <AdminHeading eyebrow={variant.sku} title={variant.products.name} description={variant.option_label ?? undefined} />
        {variant.publication_status !== "archived" && <div className={styles.purchaseAction}>
          <AdminLink href={`/admin/purchase-orders?variant=${id}`}>Add to purchase order</AdminLink>
        </div>}
        <EditorWorkspace key={id}>
          <AdminSection title="Pricing & costs">
            <div className={styles.pricing}>
              <VariantPricing prices={tierPrices(variant)} landedUnitPence={cost.cost?.landed_unit_pence} costSource={cost.cost?.source} readOnly />
              <VariantCost id={id} result={cost} />
            </div>
          </AdminSection>
        </EditorWorkspace>
      </div>
    );
  }
  const [record, cost] = await Promise.all([getAdminCatalogueVariant(id), getCurrentStaffCost(db, roles, id)]);
  if (!record) notFound();

  const { variant, family, categories, substrates, brands } = record;
  const media = resolveCatalogueMedia(family.media, family.family_code, variant.sku, variant.publication_status);
  const action = editCatalogueVariant.bind(null, id);
  const selectedSubstrates = new Set(variant.variant_substrates.map(({ substrate }) => substrate));
  const specs = Object.entries(variant.specs ?? {}).map(([label, value]) => `${label}: ${value}`).join("\n");
  const published = variant.publication_status === "published";
  const draft = variant.publication_status === "draft";
  const editable = variant.publication_status !== "archived";

  return (
    <div className={styles.editor}>
      <AdminLink href="/admin/catalogue">{staffDestinationLabels.productsAndPrices}</AdminLink>
      <AdminHeading eyebrow={variant.sku} title={family.name} description={variant.option_label ?? undefined} />
      {editable && <div className={styles.purchaseAction}>
        <AdminLink href={`/admin/purchase-orders?variant=${id}`}>Add to purchase order</AdminLink>
      </div>}
      <nav aria-label="Variant editor sections" className={styles.sectionNav}>
        {sections.filter(([section]) => editable || section === "overview" || section === "pricing")
          .map(([section, label]) => <a key={section} href={`#${section}`}>{label}</a>)}
      </nav>
      <EditorWorkspace key={id} sellingVersion={`${variant.catalogue_updated_at}:${family.updated_at}`}>
        {editable && (
          <EditorForm id={sellingFormId} action={action} submit="Save selling data" selling>
            <input type="hidden" name="version" value={variant.catalogue_updated_at} />
            <input type="hidden" name="familyVersion" value={family.updated_at} />
            <input type="hidden" name="operation" value="save" />
          </EditorForm>
        )}
        <section id="overview" tabIndex={-1} className={`admin-section ${styles.section}`}>
          <p className="eyebrow">This SKU</p>
          <h2>Overview &amp; publication</h2>
          <div className={styles.overview}>
            <div className="admin-panel">
              <h3>Identity &amp; stock</h3>
              <dl className="admin-spec">
                <dt>Family code</dt><dd className="admin-mono">{family.family_code}</dd>
                <dt>Edgey SKU</dt><dd className="admin-mono">{variant.sku}</dd>
                <dt>Stock status</dt><dd>{variant.availability === "in_stock" ? "In stock" : "Out of stock"}</dd>
              </dl>
              {roles.includes("warehouse") && <AdminLink href={`/admin/stock/${id}`}>View stock and receipts</AdminLink>}
            </div>
            <div className="admin-panel">
              <h3>Publication</h3>
              <dl className="admin-spec">
                <dt>Status</dt><dd aria-live="polite">{displayState(variant.publication_status)}</dd>
              </dl>
              {editable ? <>
                <SellingDraftNotice canRetire={cost.available} />
                <AdminForm key={published ? "unpublish" : "publish"} action={action} submit={published ? "Unpublish variant" : "Publish variant"}
                  confirmation={published ? {
                    description: "Returning this SKU to draft hides it and its references from the storefront and Finder. Existing orders and stock do not change.",
                    label: "I confirm this SKU should return to draft",
                  } : undefined}>
                  <input type="hidden" name="version" value={variant.catalogue_updated_at} />
                  <input type="hidden" name="operation" value={published ? "unpublish" : "publish"} />
                  {!published && <p>Publishing requires an approved variant, complete selling data and an approved public OEM reference.</p>}
                </AdminForm>
                {cost.available && <AdminForm action={archiveVariant.bind(null, id)} submit="Retire this variant"
                  confirmation={{
                    description: "Retiring removes this SKU and its references from the storefront and Finder. It keeps order history and stock. You can’t publish a retired variant again.",
                    label: "Permanently retire this SKU",
                    name: "confirmArchive",
                  }}>
                  <input type="hidden" name="version" value={variant.catalogue_updated_at} />
                </AdminForm>}
              </> : <p className="admin-muted">This variant is retired. Its stock and previous orders are still available to staff.</p>}
            </div>
          </div>
          {(media.drawing || media.photo) && (
            <details className={`admin-panel ${styles.artwork}`}>
              <summary>Identification artwork</summary>
              <div className={styles.artworkGrid}>
                <figure>
                  <div className="p-card-image">
                    {media.photo
                      ? <Image src={"/photos/" + media.photo} width={627} height={627} alt={"Photograph for " + variant.sku} unoptimized />
                      : <span className="plate-code">{variant.sku}</span>}
                  </div>
                  <figcaption className="fine">{!media.photo ? "No photograph for display here." : media.photo.startsWith("staging/") ? "Reference photograph · private staging only." : "Reference photograph."}</figcaption>
                </figure>
                {media.drawing && <figure>
                  <div className="p-card-image" data-proof={media.proof}>
                    <Image src={"/line-art/" + media.drawing} width={320} height={176} alt={"Line drawing for " + variant.sku} unoptimized />
                  </div>
                  <figcaption className="fine">Drawing for identification. Not to scale.</figcaption>
                </figure>}
              </div>
            </details>
          )}
        </section>
        <section id="pricing" tabIndex={-1} className={`admin-section ${styles.section}`}>
          <p className="eyebrow">This SKU</p>
          <h2>Pricing &amp; costs</h2>
          <div className={styles.pricing}>
            <VariantPricing prices={tierPrices(variant)} landedUnitPence={cost.cost?.landed_unit_pence} costSource={cost.cost?.source}
              readOnly={!editable} draft={draft} />
            <VariantCost id={id} result={cost} />
          </div>
        </section>
        {editable && (
          <>
            <section id="specifications" tabIndex={-1} className={`admin-section ${styles.section}`}>
              <p className="eyebrow">This SKU</p>
              <h2>Specifications &amp; materials</h2>
              <p className="admin-muted">Changing this SKU’s supplier, configuration, specifications or materials returns it and its approved references to review. If published, it goes back to draft.</p>
              <SellingFields>
                <div className={`admin-panel ${styles.fields}`}>
                  <h3>Variant identity &amp; dimensions</h3>
                  <div className={styles.specGrid}>
                    <AdminField label="Variant option label"><input form={sellingFormId} name="option_label" defaultValue={variant.option_label ?? ""} maxLength={160} /></AdminField>
                    <AdminField label="Tool or holder"><input form={sellingFormId} name="tool" defaultValue={variant.tool ?? ""} maxLength={160} /></AdminField>
                    <AdminField label="Supplier name"><input form={sellingFormId} name="supplier_name" defaultValue={variant.supplier_name ?? ""} maxLength={160} /></AdminField>
                    <AdminField label="Supplier part number"><input form={sellingFormId} name="supplier_part_number" defaultValue={variant.supplier_part_number ?? ""} maxLength={160} /></AdminField>
                    <AdminField label="Angle (degrees)"><input form={sellingFormId} type="number" name="angle_deg" defaultValue={variant.angle_deg ?? ""} min={0.1} max={179.9} step={0.1} /></AdminField>
                    <AdminField label="Shank (mm)"><input form={sellingFormId} type="number" name="shank_mm" defaultValue={variant.shank_mm ?? ""} min={0.01} max={999.99} step={0.01} /></AdminField>
                    <AdminField label="Cutting depth (mm)"><input form={sellingFormId} type="number" name="cutting_depth_mm" defaultValue={variant.cutting_depth_mm ?? ""} min={0.01} max={999.99} step={0.01} /></AdminField>
                    <AdminField label="Blade thickness (mm)"><input form={sellingFormId} type="number" name="blade_thickness_mm" defaultValue={variant.blade_thickness_mm ?? ""} min={0.01} max={999.99} step={0.01} /></AdminField>
                    <AdminField label="Diameter (mm)"><input form={sellingFormId} type="number" name="diameter_mm" defaultValue={variant.diameter_mm ?? ""} min={0.01} max={999.99} step={0.01} /></AdminField>
                  </div>
                  <AdminField label="Extra specifications (one “Label: value” per line)">
                    <textarea form={sellingFormId} name="specs" rows={4} maxLength={4000} defaultValue={specs} />
                  </AdminField>
                </div>
                <fieldset className={`admin-panel ${styles.materials}`}>
                  <legend>Verified materials</legend>
                  <div>
                    {substrates.map(({ slug, name }) => (
                      <label key={slug} className="admin-check">
                        <input form={sellingFormId} type="checkbox" name="substrates" value={slug} defaultChecked={selectedSubstrates.has(slug)} />
                        <span>{name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </SellingFields>
            </section>
            <section id="compatibility" tabIndex={-1} className={`admin-section ${styles.section}`}>
              <p className="eyebrow">This SKU</p>
              <h2>Compatibility &amp; approval</h2>
              <SellingDraftNotice />
              <div className={`admin-panel ${styles.fields}`}>
                <h3>Variant approval</h3>
                <p>Record supplier evidence for this exact SKU and its selling data. Rejecting a published variant takes it off the storefront.</p>
                <ReviewRecord state={variantReviewStatus(variant)} source={variant.evidence_source} note={variant.evidence_note}
                  date={variant.approved_at ?? variant.rejected_at} reviewer={variant.approved_by ?? variant.rejected_by} />
                <AdminForm action={action} submit="Record variant review" preserveOnError>
                  <input type="hidden" name="version" value={variant.catalogue_updated_at} />
                  <ReviewFields id="variant-rejection-consequence"
                    consequence="Rejecting a published SKU returns it to draft and hides it and its references from the storefront and Finder." />
                </AdminForm>
              </div>
              <div className={styles.references}>
                <h3>Compatibility references</h3>
                <p>Record the original OEM reference separately from the supplier’s evidence that the replacement blade fits. Private references stay private after review.</p>
                {variant.compatibility.length === 0 && <AdminNotice>No compatibility references have been imported for this variant.</AdminNotice>}
                {variant.compatibility.map((mapping) => (
                  <details key={mapping.id} className="admin-panel">
                    <summary><span className="admin-mono">{mapping.code}</span> · {displayState(mapping.verification_state)}{mapping.is_private && <span className={styles.staffOnly}>Staff only</span>}</summary>
                    <ReviewRecord state={displayState(mapping.verification_state)} source={mapping.evidence_source} note={mapping.evidence_note} url={mapping.evidence_url}
                      date={mapping.approved_at ?? mapping.rejected_at} reviewer={mapping.approved_by ?? mapping.rejected_by} />
                    <AdminForm action={action} submit={`Record review for ${mapping.code}`} preserveOnError>
                      <input type="hidden" name="version" value={variant.catalogue_updated_at} />
                      <input type="hidden" name="mappingId" value={mapping.id} />
                      <input type="hidden" name="mappingVersion" value={mapping.updated_at} />
                      <div className="admin-grid">
                        <AdminField label="OEM brand">
                          <select name="brand" defaultValue={mapping.brand ?? ""}>
                            <option value="">Not set</option>
                            {brands.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
                          </select>
                        </AdminField>
                        <AdminField label="Machine or restriction"><input name="machine" defaultValue={mapping.machine ?? ""} maxLength={160} /></AdminField>
                        <AdminField label="Tool or holder"><input name="tool" defaultValue={mapping.tool ?? ""} maxLength={160} /></AdminField>
                        <AdminField label="Adapter"><input name="adapter" defaultValue={mapping.adapter ?? ""} maxLength={160} /></AdminField>
                      </div>
                      <ReviewFields id={`reference-rejection-${mapping.id}`} consequence={mapping.is_private
                        ? "This reference is staff-only. Rejecting it does not change storefront visibility."
                        : mapping.verification_state === "approved"
                          ? published
                            ? "Rejecting removes this reference from the storefront and Finder. If it is the last approved public reference, the SKU also goes back to draft."
                            : "Rejecting revokes approval for this reference. The SKU is not currently visible on the storefront or Finder."
                          : "This reference is not approved for the storefront or Finder. Rejecting records your decision without changing storefront visibility."} />
                      <AdminField label="Evidence URL (optional)"><input name="url" type="url" maxLength={500} /></AdminField>
                    </AdminForm>
                  </details>
                ))}
              </div>
            </section>
            <section id="family" tabIndex={-1} className={`admin-section ${styles.section} ${styles.family}`}>
              <p className="eyebrow">All SKUs in {family.family_code}</p>
              <h2>Family details</h2>
              <p>Changes here apply to every SKU in this family.</p>
              <SellingFields>
                <div className={`admin-panel ${styles.fields}`}>
                  <div className="admin-grid">
                    <AdminField label="Family name"><input form={sellingFormId} name="name" defaultValue={family.name} maxLength={160} required /></AdminField>
                    <AdminField label="Tool category">
                      <select form={sellingFormId} name="tool_category" defaultValue={family.tool_category} required>
                        {categories.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
                      </select>
                    </AdminField>
                  </div>
                  <AdminField label="Family description"><textarea form={sellingFormId} name="description" defaultValue={family.description} maxLength={2000} rows={3} required /></AdminField>
                </div>
              </SellingFields>
            </section>
          </>
        )}
      </EditorWorkspace>
    </div>
  );
}
