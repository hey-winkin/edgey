import type { Metadata } from "next";
import { CatalogueSection } from "@/components/catalogue-section";
import { MaterialIndex } from "@/components/material-index";
import { readFilters, type RouteQuery } from "@/lib/catalogue";
import { loadCatalogue } from "@/lib/catalogue/server";
import { siteUrl } from "@/lib/catalogue/site-url";

type Props = { searchParams: Promise<RouteQuery> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const filters = readFilters(await searchParams, true);
  return {
    title: "Blade catalogue",
    description:
      "Find a replacement blade by part number, Edgey SKU, machine, tool head, material or cutting depth.",
    ...(Object.values(filters).some(Boolean)
      ? { robots: { index: false, follow: true } }
      : { alternates: { canonical: siteUrl("/blades") } }),
  };
}

export default async function BladesPage({ searchParams }: Props) {
  const filters = readFilters(await searchParams, true);
  const view = await loadCatalogue(filters);
  return (
    <main>
      <CatalogueSection view={view} filters={filters} asPage />
      <MaterialIndex materials={view.materials} />
    </main>
  );
}
