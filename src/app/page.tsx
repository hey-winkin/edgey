import type { Metadata } from "next";
import { HomeContent } from "@/components/home-content";
import { OriginalHomeHero } from "@/components/original-home-hero";
import { readFilters, type RouteQuery } from "@/lib/catalogue";
import { loadCatalogue } from "@/lib/catalogue/server";
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
  const view = await loadCatalogue(filters);
  return <HomeContent hero={<OriginalHomeHero />} view={view} filters={filters} />;
}
