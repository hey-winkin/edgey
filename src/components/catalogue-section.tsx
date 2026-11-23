import Link from "next/link";
import { bladeCount, formatNumber, toolHeadsForMachine, type CatalogueFilters, type CatalogueView } from "@/lib/catalogue";
import { CatalogueControls, CatalogueFacets } from "./catalogue-controls";
import { Breadcrumbs, catalogueCrumb } from "./breadcrumbs";
import styles from "./catalogue-filters.module.css";
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
  const { type, machine, material, head, depth } = filters;
  const unlistedHead = asPage && head && !toolHeadsForMachine(view.toolHeads, machine).some(({ slug }) => slug === head);
  const hasFacets = Boolean(type || machine || material || head || depth);
  const active = asPage ? [
    query && `Search: “${query}”`,
    type && `Tool type: ${view.toolTypes.find(({ slug }) => slug === type)?.name ?? type}`,
    machine && `Machine: ${view.machines.find(({ slug }) => slug === machine)?.name ?? machine}`,
    material && `Material: ${view.activeMaterial?.name ?? material}`,
    head && `Tool head: ${view.toolHeads.find(({ slug }) => slug === head)?.name ?? head}`,
    depth && `Cutting depth: at least ${formatNumber(Number(depth))} mm`,
  ].filter(Boolean) : [view.activeMaterial?.name].filter(Boolean);
  const excluded = view.missingDepthCount > 0
    ? `${view.missingDepthCount} otherwise matching blade option${view.missingDepthCount === 1 ? "" : "s"} left out because no cutting depth is recorded.`
    : "";

  return (
    <section className={"catalogue" + (asPage ? " is-page" : "")} id="catalogue" tabIndex={-1} aria-labelledby="catalogue-title">
      {view.finderEventId && <FinderAttribution eventId={view.finderEventId} />}
      <div className="frame">
        {asPage && <Breadcrumbs items={[{ href: "/", label: "Home" }, catalogueCrumb]} />}
        <div className={"section-head" + (asPage ? " " + styles.heading : "")}>
          <Heading id="catalogue-title" className={asPage ? "page-title" : undefined}>
            Blade catalogue
          </Heading>
          {heroSearch ? (
            <div className="controls">
              <CatalogueFacets filters={filters} toolTypes={view.toolTypes} machines={view.machines} form="catalogue-controls" />
            </div>
          ) : (
            <CatalogueControls
              filters={filters}
              toolTypes={view.toolTypes}
              machines={view.machines}
              bladeFacets={asPage ? { toolHeads: view.toolHeads, materials: view.materials } : undefined}
            />
          )}
        </div>
        {view.filtered && (
          <div className={"filter-status" + (asPage ? " " + styles.active : "")}>
            <span>{(asPage ? [count, ...active] : [...active, count]).join(" · ")}</span>
            <ClearFiltersLink>Clear filters</ClearFiltersLink>
          </div>
        )}
        {unlistedHead && (
          <p className={styles.missing} id="unlisted-tool-head">
            {machine ? "That tool head isn’t listed for the selected machine. " : "That tool head isn’t listed in the catalogue. "}
            Choose a listed tool head or clear the filters.
          </p>
        )}
        {excluded && <p className={styles.missing}>{excluded}</p>}
        <div className="cards">
          {view.cards.map((card) => (
            <ProductCard key={card.family.slug} card={card} />
          ))}
          {view.cards.length === 0 && (
            <div className="empty">
              <EmptyHeading>{query && (!asPage || !hasFacets) ? "No verified match for “" + query + "”" : "No matching blades"}</EmptyHeading>
              <p>
                {query
                  ? asPage && hasFacets
                    ? "No published blade fits this search and these filters. Try changing the filters or ask us to check compatibility."
                    : "Check the code on the packet, or open a compatibility enquiry."
                  : "No published blade fits these filters yet."}
              </p>
              <div className="empty-actions">
                <Link className="primary" href={"/enquiry" + (query ? "?q=" + encodeURIComponent(query) : "")}>
                  {asPage && !query ? "Match my blade" : "Ask us to match this blade"}
                </Link>
                <ClearFiltersLink className="textlink">Show all blades</ClearFiltersLink>
              </div>
            </div>
          )}
        </div>
        <p className="sr" aria-live="polite" role="status">
          {count} shown.{excluded && " " + excluded}
        </p>
      </div>
    </section>
  );
}
