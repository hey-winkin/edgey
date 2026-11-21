import Link from "next/link";
import { bladeCount, type CatalogueFilters, type CatalogueView } from "@/lib/catalogue";
import { CatalogueControls, CatalogueFacets } from "./catalogue-controls";
import { ClearFiltersLink } from "./catalogue-links";
import { FinderAttribution } from "./finder-attribution";
import { ProductCard } from "./product-card";

export function CatalogueSection({
  view,
  filters,
  asPage = false,
  heroSearch = false,
}: {
  view: CatalogueView;
  filters: CatalogueFilters;
  asPage?: boolean;
  heroSearch?: boolean;
}) {
  const query = filters.q.trim();
  const count = bladeCount(view.cards.length);
  const Heading = asPage ? "h1" : "h2";
  const EmptyHeading = asPage ? "h2" : "h3";

  return (
    <section className={"catalogue" + (asPage ? " is-page" : "")} id="catalogue" tabIndex={-1} aria-labelledby="catalogue-title">
      {view.finderEventId && <FinderAttribution eventId={view.finderEventId} />}
      <div className="frame">
        <div className="section-head">
          <Heading id="catalogue-title" className={asPage ? "page-title" : undefined}>
            Blade catalogue
          </Heading>
          {heroSearch ? (
            <div className="controls">
              <CatalogueFacets filters={filters} toolTypes={view.toolTypes} machines={view.machines} form="catalogue-controls" />
            </div>
          ) : <CatalogueControls filters={filters} toolTypes={view.toolTypes} machines={view.machines} />}
        </div>
        {view.filtered && (
          <div className="filter-status">
            <span>{(view.activeMaterial ? view.activeMaterial.name + " · " : "") + count}</span>
            <ClearFiltersLink>Clear filters</ClearFiltersLink>
          </div>
        )}
        <div className="cards">
          {view.cards.map((card) => (
            <ProductCard key={card.family.slug} card={card} />
          ))}
          {view.cards.length === 0 && (
            <div className="empty">
              <EmptyHeading>{query ? "No verified match for “" + query + "”" : "No matching blades"}</EmptyHeading>
              <p>
                {query
                  ? "Check the code on the packet, or open a compatibility enquiry."
                  : "No published blade fits these filters yet."}
              </p>
              <div className="empty-actions">
                <Link className="primary" href={"/enquiry" + (query ? "?q=" + encodeURIComponent(query) : "")}>
                  Ask us to match this blade
                </Link>
                <ClearFiltersLink className="textlink">Show all blades</ClearFiltersLink>
              </div>
            </div>
          )}
        </div>
        <p className="sr" aria-live="polite" role="status">
          {count} shown.
        </p>
      </div>
    </section>
  );
}
