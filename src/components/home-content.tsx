import type { ReactNode } from "react";
import type { CatalogueFilters, CatalogueView } from "@/lib/catalogue";
import { CatalogueSection } from "./catalogue-section";
import { MaterialIndex } from "./material-index";

export function HomeContent({
  hero, view, filters, skipTarget, heroSearch = false,
}: {
  hero: ReactNode;
  view: CatalogueView;
  filters: CatalogueFilters;
  skipTarget?: string;
  heroSearch?: boolean;
}) {
  return (
    <main id={skipTarget} tabIndex={skipTarget ? -1 : undefined}>
      {hero}
      <CatalogueSection view={view} filters={filters} heroSearch={heroSearch} />
      {!heroSearch && <MaterialIndex materials={view.materials} />}
    </main>
  );
}
