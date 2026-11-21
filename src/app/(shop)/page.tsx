import type { Metadata } from "next";
import { HomeContent } from "@/components/home-content";
import { SearchHomeHero } from "@/components/material-hero/search-home-hero";
import { readFilters, type RouteQuery } from "@/lib/catalogue";
import { buildCoreStudies } from "@/lib/catalogue/material-hero";
import { listFamilies, loadCatalogue } from "@/lib/catalogue/server";
import { siteUrl } from "@/lib/catalogue/site-url";

type Props = { searchParams: Promise<RouteQuery> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const filters = readFilters(await searchParams);
  return Object.values(filters).some(Boolean)
    ? { robots: { index: false, follow: true } }
    : { alternates: { canonical: siteUrl("/") } };
}

export default async function HomePage({ searchParams }: Props) {
  const filters = readFilters(await searchParams);
  const [view, families] = await Promise.all([loadCatalogue(filters), listFamilies()]);
  return (
    <HomeContent
      hero={<SearchHomeHero view={view} filters={filters} studies={buildCoreStudies(families)} />}
      view={view}
      filters={filters}
      heroSearch
    />
  );
}
