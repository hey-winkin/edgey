import type { Metadata } from "next";
import { HomeContent } from "@/components/home-content";
import { MaterialHero } from "@/components/material-hero/material-hero";
import { readFilters, type RouteQuery } from "@/lib/catalogue";
import { buildCorrugatedStudy, corrugatedSlug, featuredFamilySlug } from "@/lib/catalogue/material-hero";
import { listFamilies, loadCatalogue } from "@/lib/catalogue/server";

export const metadata: Metadata = {
  title: "Choose by material · Homepage preview",
  robots: { index: false, follow: true },
};

export default async function MaterialHeroPreview({ searchParams }: { searchParams: Promise<RouteQuery> }) {
  const params = await searchParams;
  const filters = readFilters(params);
  const [view, families] = await Promise.all([loadCatalogue(filters), listFamilies()]);
  const family = families.find(({ slug }) => slug === featuredFamilySlug) ?? null;
  return (
    <HomeContent
      view={view}
      filters={filters}
      hero={
        <MaterialHero
          materials={view.materials}
          study={buildCorrugatedStudy(family)}
          showStudy={params.study === corrugatedSlug}
          filters={filters}
        />
      }
    />
  );
}
