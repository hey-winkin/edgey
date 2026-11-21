import "server-only";
import { cache } from "react";
import {
  buildCatalogueView, type Availability, type CatalogueFilters, type Compatibility,
  type Family, type SearchHit,
} from "./index";
import { resolveCatalogueMedia } from "./media";
import { publicClient } from "./supabase";
import { recordFinderSearch } from "@/lib/requests/finder-events";

type VariantRow = {
  id: string;
  sku: string;
  option_label: string | null;
  tool: string | null;
  angle_deg: number | null;
  shank_mm: number | null;
  cutting_depth_mm: number | null;
  blade_thickness_mm: number | null;
  diameter_mm: number | null;
  specs: Record<string, string> | null;
  price_1_4_pence: number;
  price_5_9_pence: number;
  price_10_plus_pence: number;
  availability: Availability;
  sort_order: number;
  variant_substrates: { substrates: { slug: string; name: string; swatch: string | null; sort_order: number } }[];
  compatibility: {
    code: string;
    code_kind: Compatibility["kind"];
    machine: string | null;
    tool: string | null;
    adapter: string | null;
    brands: { slug: string; name: string } | null;
  }[];
};

type FamilyRow = {
  id: string;
  family_code: string;
  slug: string;
  name: string;
  description: string;
  media: unknown;
  tool_categories: { slug: string; name: string; sort_order: number };
  variants: VariantRow[];
};

// Columns are listed because public roles hold column-level grants only.
const FAMILY_SELECT = `
  id, family_code, slug, name, description, media, sort_order,
  tool_categories ( slug, name, sort_order ),
  variants (
    id, sku, option_label, tool, angle_deg, shank_mm, cutting_depth_mm, blade_thickness_mm,
    diameter_mm, specs, price_1_4_pence, price_5_9_pence, price_10_plus_pence, availability, sort_order,
    variant_substrates ( substrates ( slug, name, swatch, sort_order ) ),
    compatibility ( code, code_kind, machine, tool, adapter, brands ( slug, name ) )
  )
`;

const kindOrder = { model: 0, item_number: 1, alias: 2 } as const;

function toFamily(row: FamilyRow): Family {
  const variants = [...row.variants]
    .sort((a, b) => a.sort_order - b.sort_order || a.sku.localeCompare(b.sku))
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      media: resolveCatalogueMedia(row.media, row.family_code, variant.sku),
      optionLabel: variant.option_label,
      tool: variant.tool,
      angleDeg: variant.angle_deg,
      shankMm: variant.shank_mm,
      cuttingDepthMm: variant.cutting_depth_mm,
      bladeThicknessMm: variant.blade_thickness_mm,
      diameterMm: variant.diameter_mm,
      specs: variant.specs ?? {},
      prices: {
        oneToFour: variant.price_1_4_pence,
        fiveToNine: variant.price_5_9_pence,
        tenPlus: variant.price_10_plus_pence,
      },
      availability: variant.availability,
      substrates: variant.variant_substrates
        .map(({ substrates }) => ({
          slug: substrates.slug,
          name: substrates.name,
          swatch: substrates.swatch,
          sortOrder: substrates.sort_order,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
      compatibility: variant.compatibility
        .map((record) => ({
          code: record.code,
          kind: record.code_kind,
          brand: record.brands,
          machine: record.machine,
          tool: record.tool,
          adapter: record.adapter,
        }))
        .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.code.localeCompare(b.code)),
    }));
  return {
    id: row.id,
    familyCode: row.family_code,
    slug: row.slug,
    name: row.name,
    description: row.description,
    media: variants[0]?.media ?? {},
    toolType: { slug: row.tool_categories.slug, name: row.tool_categories.name, sortOrder: row.tool_categories.sort_order },
    variants,
  };
}

// Every family with at least one published variant, in catalogue order.
export const listFamilies = cache(async (): Promise<Family[]> => {
  const { data, error } = await publicClient().from("products").select(FAMILY_SELECT)
    .eq("variants.publication_status", "published").order("sort_order").order("slug");
  if (error) throw new Error("Catalogue read failed: " + error.message);
  return (data as unknown as FamilyRow[]).filter((row) => row.variants.length > 0).map(toFamily);
});

export const getFamily = cache(async (slug: string): Promise<Family | null> => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const { data, error } = await publicClient().from("products").select(FAMILY_SELECT)
    .eq("variants.publication_status", "published").eq("slug", slug).maybeSingle();
  if (error) throw new Error("Catalogue read failed: " + error.message);
  const row = data as unknown as FamilyRow | null;
  return row && row.variants.length > 0 ? toFamily(row) : null;
});

export const getBrandLanding = cache(async (slug: string) => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const blades = (await listFamilies()).flatMap((family) => family.variants.flatMap((variant) => {
    const references = variant.compatibility.filter((record) => record.brand?.slug === slug);
    return references.length ? [{ family, variant, references }] : [];
  }));
  const brand = blades[0]?.references[0]?.brand;
  return brand ? { brand, blades } : null;
});

const searchBlades = cache(async (query: string): Promise<SearchHit[]> => {
  const { data, error } = await publicClient().rpc("search_blades", { query_text: query });
  if (error) throw new Error("Search failed: " + error.message);
  return (data as { match_type: SearchHit["matchType"]; matched_code: string | null; product_slug: string; sku: string }[]).map(
    (row) => ({
      matchType: row.match_type,
      matchedCode: row.matched_code,
      productSlug: row.product_slug,
      sku: row.sku,
    }),
  );
});

export async function loadCatalogue(filters: CatalogueFilters) {
  const query = filters.q.trim();
  const [families, hits] = await Promise.all([listFamilies(), query ? searchBlades(query) : null]);
  const view = buildCatalogueView(families, hits, filters);
  if (hits) view.finderEventId = await recordFinderSearch(filters, hits, view);
  return view;
}
