import { bladeCount, type CatalogueFilters, type CatalogueView } from "@/lib/catalogue";
import { corrugatedSlug, type CorrugatedStudy } from "@/lib/catalogue/material-hero";
import { annotationTags, CorrugatedDrawing, CorrugatedSwatch, MaterialPlaceholderSwatch } from "./material-art";
import styles from "./material-hero.module.css";

const previewPath = "/preview/material-hero";

function studyHref(filters: CatalogueFilters, study?: string) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  if (study) query.set("study", study);
  return previewPath + (query.size ? "?" + query : "") + "#material-hero-title";
}

function QualityPlaceholder() {
  return (
    <div className={styles.quality}>
      <p className={styles.label}><span>Placeholder</span> Blade quality</p>
      <p>The owner will supply two or three verified facts.</p>
    </div>
  );
}

export function MaterialHero({
  materials,
  study,
  showStudy,
  filters,
}: {
  materials: CatalogueView["materials"];
  study: CorrugatedStudy | null;
  showStudy: boolean;
  filters: CatalogueFilters;
}) {
  if (study && showStudy) return <CorrugatedDetail study={study} filters={filters} />;

  return (
    <section className={`frame ${styles.hero} ${styles.chooser}`} aria-labelledby="material-hero-title">
      <div className={styles.intro}>
        <p className="kicker"><span className="register" aria-hidden="true" /> Digital cutter tooling</p>
        <h1 id="material-hero-title" className={styles.title} tabIndex={-1}>Find a blade by material<span>.</span></h1>
        <p>What’s on your cutting bed? Pick a material to see the blades that cut it.</p>
      </div>
      {materials.length ? (
        <ul className={styles.tiles} role="list" aria-label="Materials">
          {materials.map((material) => {
            const corrugated = material.slug === corrugatedSlug;
            const featured = corrugated && Boolean(study);
            const note = featured ? "View cutting study" : bladeCount(material.count);
            return (
              <li key={material.slug} className={featured ? styles.featured : undefined}>
                <a
                  className={styles.tile}
                  href={featured ? studyHref(filters, corrugatedSlug) : "/blades?material=" + encodeURIComponent(material.slug)}
                  aria-label={material.name + ", " + note}
                >
                  <div className={styles.swatch}>
                    {corrugated ? <CorrugatedSwatch /> : <MaterialPlaceholderSwatch />}
                  </div>
                  <div className={styles.tileCaption}>
                    <strong>{material.name}</strong>
                    <span className={styles.tileArrow} aria-hidden="true">↗</span>
                    <span className={styles.tileNote}>{note}</span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      ) : <p className={styles.empty}>No materials have published blades yet.</p>}
      <QualityPlaceholder />
    </section>
  );
}

function CorrugatedDetail({ study, filters }: { study: CorrugatedStudy; filters: CatalogueFilters }) {
  const annotations = Object.fromEntries(study.annotations.map(({ key, label, value }) => [key, label + " · " + value]));

  return (
    <section className={`frame ${styles.hero}`} aria-labelledby="material-hero-title">
      <div className={styles.detailHead}>
        <div className={styles.intro}>
          <p className="kicker"><span className="register" aria-hidden="true" /> Material cutting study</p>
          <h1 id="material-hero-title" className={styles.title} tabIndex={-1}>{study.material.name}<span>.</span></h1>
        </div>
        <a className={`textlink ${styles.back}`} href={studyHref(filters)}><span aria-hidden="true">←</span> All materials</a>
      </div>
      <div className={styles.detail}>
        <figure className={styles.plate}>
          <div className={styles.plateHead}>
            <span>Section view</span>
            <span>Not to scale</span>
          </div>
          <div className={styles.canvas}>
            <CorrugatedDrawing annotations={annotations} />
          </div>
          <figcaption className={styles.caption}>
            Side-on view of an oscillating blade cutting through the liners and fluted core, leaving a clean slit behind it.
            {study.annotations.length > 0 && (
              <dl className={styles.specs}>
                {study.annotations.map(({ key, label, value }) => (
                  <div key={key}>
                    <dt><span className={styles.specTag} aria-hidden="true">{annotationTags[key]}</span>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </figcaption>
        </figure>
        <div className={styles.sidebar}>
          <div className={styles.fit}>
            <p className={styles.label}>{study.sku}</p>
            <h2>{study.name}</h2>
            {study.model && <p className={styles.reference}>OEM reference: {study.brand} {study.model}</p>}
            {study.fits.length > 0 && (
              <ul className={styles.fitList} role="list" aria-label="Compatible machines and tools">
                {study.fits.map(({ machine, tool, adapter }) => (
                  <li key={JSON.stringify([machine, tool, adapter])}>
                    <dl>
                      {machine && <div><dt>Compatible machines</dt><dd>{study.brand} {machine}</dd></div>}
                      {tool && <div><dt>Tool heads</dt><dd>{tool}</dd></div>}
                      {adapter && <div><dt>Adapter</dt><dd>{adapter}</dd></div>}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.evidence}>Owner-supplied specifications (unverified).</p>
            <a className="primary" href={study.href}>View blade details</a>
          </div>
          <QualityPlaceholder />
        </div>
      </div>
    </section>
  );
}
