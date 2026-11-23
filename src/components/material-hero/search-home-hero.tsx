import Link from "next/link";
import type { ReactNode } from "react";
import { CatalogueControls } from "@/components/catalogue-controls";
import { bladeCount, brandHref, type CatalogueFilters, type CatalogueView } from "@/lib/catalogue";
import { corrugatedSlug, type CuttingStudy } from "@/lib/catalogue/material-hero";
import { CoreMaterialDrawing, CoreMaterialSwatch } from "./core-material-art";
import { AdditionalMaterialDrawing, additionalIllustration } from "./extended-material-art";
import { annotationTags, CorrugatedDrawing, CorrugatedSwatch } from "./material-art";
import { HomeBrowseLink } from "./home-browse-link";
import styles from "./search-home-hero.module.css";

export function SearchHomeHero({ view, filters, coreStudies, moreStudies, qualityFacts }: {
  view: CatalogueView;
  filters: CatalogueFilters;
  coreStudies: CuttingStudy[];
  moreStudies: CuttingStudy[];
  qualityFacts?: ReactNode;
}) {
  const studies = [...coreStudies, ...moreStudies];
  const selected = filters.material
    ? studies.find(({ material }) => material.slug === filters.material)
    : studies[0];
  const selectedMore = selected && moreStudies.includes(selected) ? selected : undefined;
  const moreLabel = coreStudies.length > 0 ? "More studies" : "Cutting studies";
  const matchingCount = view.materials.find(({ slug }) => slug === selected?.material.slug)?.count;
  const searchScope = [
    view.activeMaterial?.name,
    view.machines.find(({ slug }) => slug === filters.machine)?.name,
    view.toolTypes.find(({ slug }) => slug === filters.type)?.name,
  ].filter(Boolean).join(" · ");

  return (
    <section className={`hero frame ${styles.hero}`} aria-labelledby="home-hero-title">
      <div className={styles.finder}>
        <p className="kicker"><span className="register" aria-hidden="true" /> Digital cutter tooling</p>
        <h1 id="home-hero-title">Find a blade<span>.</span></h1>
        <p className={styles.intro}>Replacement blades for digital cutters and plotters.</p>
        <div className={styles.search}>
          <CatalogueControls filters={filters} searchFirst />
          {(filters.material || filters.machine || filters.type) && (
            <p className={styles.searchScope}>
              {searchScope ? "Searching within: " + searchScope + "." : "Catalogue filters are active."}{" "}
              <HomeBrowseLink className="textlink" href={filters.q ? "/?q=" + encodeURIComponent(filters.q) : "/"}>
                Search all blades
              </HomeBrowseLink>
            </p>
          )}
          {filters.q && (view.cards.length > 0 ? (
            <a className={`textlink ${styles.results}`} href="#catalogue">{bladeCount(view.cards.length)} found · View results</a>
          ) : (
            <Link className={`textlink ${styles.results}`} href={"/enquiry?q=" + encodeURIComponent(filters.q)}>
              No match · Ask us
            </Link>
          ))}
        </div>
        {view.machines.length > 0 && (
          <nav className={styles.group} aria-labelledby="home-machine-title">
            <h2 id="home-machine-title" className={styles.label}>Browse by machine</h2>
            <ul className={styles.brands} role="list">
              {view.machines.map((brand) => (
                <li key={brand.slug}><Link href={brandHref(brand.slug)} prefetch={false}>{brand.name}</Link></li>
              ))}
            </ul>
          </nav>
        )}
        <nav className={styles.group} id="materials" aria-labelledby="home-material-title" tabIndex={-1}>
          <div className={styles.materialHead}>
            <h2 id="home-material-title" className={styles.label}>Browse by material</h2>
            <Link className="textlink" href="/blades#materials">All materials <span aria-hidden="true">↗</span></Link>
          </div>
          {coreStudies.length > 0 && (
            <ul className={styles.materials} role="list">
              {coreStudies.map(({ material }) => (
                <li key={material.slug}>
                  <HomeBrowseLink href={"/?material=" + encodeURIComponent(material.slug)} current={selected?.material.slug === material.slug} className={styles.tile}>
                    <span className={styles.swatch}>
                      {material.slug === corrugatedSlug ? <CorrugatedSwatch /> : <CoreMaterialSwatch material={material.slug} />}
                    </span>
                    <span className={styles.tileName}>{material.name}</span>
                  </HomeBrowseLink>
                </li>
              ))}
            </ul>
          )}
          {moreStudies.length > 0 && (
            <details className={styles.more}>
              <summary>
                <span>{moreLabel} <span className={styles.moreCount}>({moreStudies.length})</span></span>
                {selectedMore && <>{" "}<span className={styles.moreCurrent}>{selectedMore.material.name}</span></>}
              </summary>
              <ul role="list">
                {moreStudies.map(({ material }) => (
                  <li key={material.slug}>
                    <HomeBrowseLink href={`/?material=${encodeURIComponent(material.slug)}`} current={selectedMore?.material.slug === material.slug}>
                      {material.name}
                    </HomeBrowseLink>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </nav>
        {qualityFacts && <div className={styles.group}>{qualityFacts}</div>}
      </div>
      <p className="sr" aria-live="polite">{selected ? "Cutting study: " + selected.material.name : ""}</p>
      {selected ? <CuttingStudyPanel study={selected} count={matchingCount ?? 0} /> : filters.material && (
        <div className={`${styles.plate} ${styles.unillustrated}`}>
          <p className={styles.label}>Cutting study</p>
          <p>{view.activeMaterial ? "No cutting study for " + view.activeMaterial.name + "." : "No cutting study for this material."}</p>
          <a className="textlink" href="#catalogue">View catalogue results</a>
        </div>
      )}
    </section>
  );
}

function CuttingStudyPanel({ study, count }: { study: CuttingStudy; count: number }) {
  const { material } = study;
  const annotations = Object.fromEntries(study.annotations.map(({ key, label, value }) => [key, label + " · " + value]));
  const illustration = additionalIllustration(material.slug);

  return (
    <section className={styles.plate} aria-labelledby="home-study-title">
      <div className={styles.plateHead}>
        <div>
          <p className={styles.label}>Cutting study</p>
          <h2 id="home-study-title">{material.name}</h2>
        </div>
        <p className={styles.plateNote}>Section view<br />Not to scale</p>
      </div>
      <figure>
        <div className={styles.canvas}>
          {illustration
            ? <AdditionalMaterialDrawing illustration={illustration} annotations={annotations} />
            : material.slug === corrugatedSlug
            ? <CorrugatedDrawing annotations={annotations} />
            : <CoreMaterialDrawing material={material.slug} annotations={annotations} />}
        </div>
        <figcaption className={styles.caption}>
          <p>{study.caption}</p>
          <dl className={styles.specs}>
            {study.annotations.map(({ key, label, value }) => (
              <div key={key}>
                <dt>
                  {(!illustration || illustration.leaders.some((leader) => leader.key === key)) && (
                    <span className={styles.specTag} aria-hidden="true">{annotationTags[key]}</span>
                  )}
                  {label}
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </figcaption>
      </figure>
      <div className={styles.fit}>
        <p className={styles.part}><strong>{study.sku}</strong> <span>{study.name}</span></p>
        {study.model && (
          <p className={styles.reference}>
            {study.sharedReference ? "Shared OEM reference:" : "OEM reference:"} {study.brand} {study.model}
            {study.sharedReference && ". Check the blade configuration before ordering."}
          </p>
        )}
        {study.fits.length > 0 && (
          <ul className={styles.fitList} role="list" aria-label="Catalogue fit">
            {study.fits.map(({ brand, machine, tool, adapter }) => (
              <li key={JSON.stringify([brand, machine, tool, adapter])}>
                <dl>
                  {machine ? <div><dt>Compatible machines</dt><dd>{[brand, machine].filter(Boolean).join(" ")}</dd></div>
                    : brand && <div><dt>Brand</dt><dd>{brand}</dd></div>}
                  {tool && <div><dt>Tool heads</dt><dd>{tool}</dd></div>}
                  {adapter && <div><dt>Adapter</dt><dd>{adapter}</dd></div>}
                </dl>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.evidence}>Owner-supplied specifications (unverified).</p>
        <div className={styles.actions}>
          <a className="secondary" href={study.href}>View blade details</a>
          <HomeBrowseLink href={"/?material=" + encodeURIComponent(material.slug) + "#catalogue"} className="textlink" scroll>
            See {bladeCount(count)} for {material.name} <span aria-hidden="true">↓</span>
          </HomeBrowseLink>
        </div>
      </div>
    </section>
  );
}
