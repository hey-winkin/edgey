import type { Metadata } from "next";
import { HomeContent } from "@/components/home-content";
import { OriginalHomeHero } from "@/components/original-home-hero";
import { readFilters, type RouteQuery } from "@/lib/catalogue";
import { loadCatalogue } from "@/lib/catalogue/server";

export const metadata: Metadata = {
  title: "The cutting room · Original homepage preview",
  robots: { index: false, follow: false },
};

export default async function OriginalHeroPreview({ searchParams }: { searchParams: Promise<RouteQuery> }) {
  const filters = readFilters(await searchParams);
  const view = await loadCatalogue(filters);
  return <HomeContent hero={<OriginalHomeHero />} view={view} filters={filters} skipTarget="main-content" />;
}
