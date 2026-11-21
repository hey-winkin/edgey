import type { ReactNode } from "react";
import type { CatalogueFilters, CatalogueView } from "@/lib/catalogue";
import { CatalogueSection } from "./catalogue-section";
import { MaterialIndex } from "./material-index";

export function HomeContent({ hero, view, filters }: { hero: ReactNode; view: CatalogueView; filters: CatalogueFilters }) {
  return (
    <main>
      {hero}
      <CatalogueSection view={view} filters={filters} />
      <MaterialIndex materials={view.materials} />
    </main>
  );
}
