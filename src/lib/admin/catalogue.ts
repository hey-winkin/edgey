import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseFinderCode } from "@/lib/requests/finder-query";
import { serviceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";
import type { StaffRole } from "./auth";
import { adminPage, adminRange, adminPageSize } from "./pagination";
import { stockSchemaUnavailable } from "./stock-cost-data";

type CatalogueFunctions = Pick<Database["public"]["Functions"],
  "admin_catalogue_update" | "admin_catalogue_review" | "admin_catalogue_set_publication">;

export const catalogueId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function variantReviewStatus(variant: { approved_at: string | null; rejected_at: string | null }) {
  return variant.approved_at ? "Approved" : variant.rejected_at ? "Rejected" : "Needs review";
}

export const catalogueStatuses = ["draft", "published", "archived"] as const satisfies
  readonly Database["public"]["Enums"]["publication_status"][];
export const catalogueCodeMaxLength = 80;
type CatalogueListQuery = Record<string, string | string[] | undefined>;

export async function listAdminCatalogue(
  { db, roles }: { db: SupabaseClient<Database>; roles: StaffRole[] },
  query: CatalogueListQuery,
) {
  const page = adminPage(query.page);
  const q = typeof query.q === "string" ? query.q.trim().slice(0, catalogueCodeMaxLength) : "";
  const code = normaliseFinderCode(q);
  const status = catalogueStatuses.find((value) => value === query.status);
  const service = serviceClient();
  const { data: brands, error: brandError } = await service.from("brands").select("slug, name").order("name");
  if (brandError) throw new Error("Could not load the catalogue brands.");
  const brand = brands.find(({ slug }) => slug === query.brand)?.slug;
  const filters = { q: q || undefined, status, brand };

  if (q && !code) return { brands, filters, page, length: 0, rows: [] };

  let variants = service.from("variants")
    .select(`id, sku, option_label, publication_status, approved_at, rejected_at, products(name),
      stock_on_hand, stock_reserved, price_10_plus_pence, code_matches:compatibility(), brand_matches:compatibility()`)
    .order("sku", { ascending: true });
  const canReadPrivateMappings = roles.includes("catalogue");
  if (code) {
    variants = variants.like("code_matches.code_normalised", `%${code}%`)
      .or(`sku_normalised.like.*${code}*,code_matches.not.is.null`);
    if (!canReadPrivateMappings) variants = variants.eq("code_matches.is_private", false)
      .eq("code_matches.verification_state", "approved");
  }
  if (brand) {
    variants = variants.eq("brand_matches.brand", brand).not("brand_matches", "is", null);
    if (!canReadPrivateMappings) variants = variants.eq("brand_matches.is_private", false)
      .eq("brand_matches.verification_state", "approved");
  }
  if (status) variants = variants.eq("publication_status", status);
  const { data, error } = await variants.range(...adminRange(page));
  if (error) throw new Error("Could not load the staff catalogue.");

  const visible = data.slice(0, adminPageSize);
  const costs = visible.length ? await db.from("staff_current_variant_costs").select("variant_id")
    .in("variant_id", visible.map(({ id }) => id)) : { data: [], error: null };
  if (costs.error && !stockSchemaUnavailable(costs.error)) throw new Error("Could not load catalogue cost status.");

  const costedIds = new Set(costs.data?.map(({ variant_id }) => variant_id));
  return {
    brands, filters, page, length: data.length,
    rows: visible.map((variant) => {
      const costStatus: "unavailable" | "recorded" | "missing" =
        costs.error ? "unavailable" : costedIds.has(variant.id) ? "recorded" : "missing";
      return {
        id: variant.id,
        sku: variant.sku,
        name: variant.products?.name,
        option: variant.option_label,
        status: variant.publication_status,
        review: variantReviewStatus(variant),
        available: variant.stock_on_hand - variant.stock_reserved,
        priceFromPence: variant.price_10_plus_pence,
        costStatus,
      };
    }),
  };
}

export async function getAdminCatalogueVariant(id: string) {
  const db = serviceClient();
  const { data: variant, error } = await db.from("variants").select(`
    id, sku, option_label, tool, angle_deg, shank_mm, cutting_depth_mm, blade_thickness_mm, diameter_mm, specs,
    supplier_name, supplier_part_number, price_1_4_pence, price_5_9_pence, price_10_plus_pence, availability,
    publication_status, approved_at, approved_by, rejected_at, rejected_by, evidence_source, evidence_note, catalogue_updated_at,
    products(name, family_code, description, tool_category, media, updated_at), variant_substrates(substrate),
    compatibility(id, code, code_kind, brand, machine, tool, adapter, evidence_source, evidence_note, evidence_url,
      verification_state, is_private, approved_at, approved_by, rejected_at, rejected_by, updated_at)
  `).eq("id", id).order("code", { referencedTable: "compatibility" }).maybeSingle();
  if (error) throw new Error("Could not load the catalogue variant.");
  if (!variant?.products) return null;

  const [categories, substrates, brands] = await Promise.all([
    db.from("tool_categories").select("slug, name").order("sort_order"),
    db.from("substrates").select("slug, name").order("name"),
    db.from("brands").select("slug, name").order("name"),
  ]);
  if (categories.error || substrates.error || brands.error) throw new Error("Could not load catalogue options.");
  return { variant, family: variant.products, categories: categories.data, substrates: substrates.data, brands: brands.data };
}

export async function getAdminCataloguePricing(id: string) {
  const { data, error } = await serviceClient().from("variants")
    .select("sku, option_label, price_1_4_pence, price_5_9_pence, price_10_plus_pence, products(name)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the variant prices.");
  return data;
}

export async function mutateAdminCatalogue<K extends keyof CatalogueFunctions>(
  name: K, args: CatalogueFunctions[K]["Args"],
) {
  return serviceClient().rpc(name, args);
}
