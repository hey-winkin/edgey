import "server-only";

import { resolveCatalogueMedia } from "@/lib/catalogue/media";
import { normaliseFinderCode } from "@/lib/requests/finder-query";
import { serviceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";

export type PurchaseVariant = {
  id: string;
  sku: string;
  name: string;
  option: string | null;
  status: Database["public"]["Enums"]["publication_status"];
  drawing?: string;
};

const selection = "id, sku, sku_normalised, option_label, publication_status, products!inner(name, family_code, media)";
export const purchaseCataloguePageSize = 8;
export const purchaseCatalogueMaxPage = 10_000;
const makerKinds = ["model", "item_number"] as const;

type VariantRow = {
  id: string;
  sku: string;
  option_label: string | null;
  publication_status: PurchaseVariant["status"];
  products: { name: string; family_code: string; media: unknown };
};

function project(row: VariantRow): PurchaseVariant {
  const { id, sku, option_label: option, publication_status: status, products: product } = row;
  return { id, sku, name: product.name, option, status, drawing: resolveCatalogueMedia(product.media, product.family_code, sku, status).drawing };
}

export async function purchaseCatalogueBrands() {
  const { data, error } = await serviceClient().from("brands").select("slug, name").order("name");
  if (error) throw new Error("Could not load machine brands.");
  return data;
}

export async function searchPurchaseCatalogue(query: string, brand: string, page: number) {
  const code = normaliseFinderCode(query);
  let variants = serviceClient().from("variants")
    .select(`${selection}, name_match:products(), maker_match:compatibility(), brand_match:compatibility()`)
    .neq("publication_status", "archived").order("sku").order("id");
  if (query) {
    const matches: string[] = [];
    if (!query.includes("*")) {
      const name = query.replace(/[\\%_]/g, "\\$&");
      variants = variants.ilike("name_match.name", `%${name}%`);
      matches.push("name_match.not.is.null");
    }
    if (code) {
      variants = variants.like("maker_match.code_normalised", `%${code}%`)
        .in("maker_match.code_kind", makerKinds).eq("maker_match.is_private", false)
        .neq("maker_match.verification_state", "rejected");
      matches.push(`sku_normalised.like.*${code}*`, "maker_match.not.is.null");
    }
    if (!matches.length) return { results: [], more: false };
    variants = variants.or(matches.join(","));
  }
  if (brand) {
    variants = variants.eq("brand_match.brand", brand).eq("brand_match.is_private", false)
      .neq("brand_match.verification_state", "rejected").not("brand_match", "is", null);
  }
  const start = (page - 1) * purchaseCataloguePageSize;
  const { data, error } = await variants.range(start, start + purchaseCataloguePageSize);
  if (error) throw new Error("Could not search the catalogue. Try again.");
  return { results: data.slice(0, purchaseCataloguePageSize).map(project), more: data.length > purchaseCataloguePageSize };
}

export async function getPurchaseVariants(ids: string[]) {
  const batches = await Promise.all(chunk(ids).map((batch) =>
    serviceClient().from("variants").select(selection).in("id", batch)));
  return new Map(batches.flatMap(({ data, error }) => {
    if (error) throw new Error("Could not load the purchase-order products.");
    return data.map((row) => [row.id, project(row)] as const);
  }));
}

export type ExactPurchaseMatch =
  | { kind: "match"; product: PurchaseVariant }
  | { kind: "missing" | "ambiguous" };

function chunk(values: string[]) {
  return Array.from({ length: Math.ceil(values.length / 40) }, (_, i) => values.slice(i * 40, (i + 1) * 40));
}

export async function matchPurchaseCatalogueCodes(codes: string[]) {
  const keys = [...new Set(codes.map(normaliseFinderCode).filter(Boolean))];
  const matches = new Map<string, ExactPurchaseMatch>(keys.map((key) => [key, { kind: "missing" }]));
  if (!keys.length) return matches;

  const db = serviceClient();
  const skuBatches = await Promise.all(chunk(keys).map((batch) => db.from("variants").select(selection)
    .in("sku_normalised", batch)));
  const skus = skuBatches.flatMap(({ data, error }) => {
    if (error) throw new Error("Could not check the Edgey codes. Try again.");
    return data;
  });
  const skuKeys = new Set(skus.map(({ sku_normalised }) => sku_normalised));
  for (const row of skus) {
    if (row.sku_normalised && row.publication_status !== "archived") {
      matches.set(row.sku_normalised, { kind: "match", product: project(row) });
    }
  }

  const makerKeys = keys.filter((key) => !skuKeys.has(key));
  if (!makerKeys.length) return matches;
  const candidates = new Map<string, string>();
  await Promise.all(chunk(makerKeys).map(async (batch) => {
    const ambiguous = new Set<string>();
    const size = 200;
    for (let start = 0; ; start += size) {
      const { data, error } = await db.from("compatibility").select("code_normalised, variant_id")
        .in("code_normalised", batch).in("code_kind", makerKinds)
        .eq("is_private", false).neq("verification_state", "rejected").order("id").range(start, start + size - 1);
      if (error) throw new Error("Could not check the maker references. Try again.");
      for (const { code_normalised: key, variant_id: id } of data) {
        if (!key || ambiguous.has(key)) continue;
        if (candidates.has(key) && candidates.get(key) !== id) {
          candidates.delete(key);
          ambiguous.add(key);
          matches.set(key, { kind: "ambiguous" });
        } else {
          candidates.set(key, id);
        }
      }
      if (data.length < size || ambiguous.size === batch.length) break;
    }
  }));
  const products = await getPurchaseVariants([...new Set(candidates.values())]);
  for (const [key, id] of candidates) {
    const product = products.get(id);
    if (product && product.status !== "archived") {
      matches.set(key, { kind: "match", product });
    }
  }
  return matches;
}
