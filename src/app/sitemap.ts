import type { MetadataRoute } from "next";
import { brandHref, productHref } from "@/lib/catalogue";
import { indexableSiteOrigin } from "@/lib/catalogue/indexable-site";
import { publicClient } from "@/lib/catalogue/supabase";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = indexableSiteOrigin();
  if (!origin) return [];
  const db = publicClient();
  const [products, brands] = await Promise.all([
    db.from("products").select("slug").order("slug"),
    db.from("brands").select("slug").order("slug"),
  ]);
  if (products.error || brands.error) throw new Error("Published sitemap could not be loaded.");
  return ["/", "/blades", "/reference-guide", ...products.data.map(({ slug }) => productHref(slug)), ...brands.data.map(({ slug }) => brandHref(slug))]
    .map((path) => ({ url: origin + path }));
}
