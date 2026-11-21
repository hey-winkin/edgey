import { bladeCount, type CatalogueView } from "@/lib/catalogue";
import { MaterialLink } from "./catalogue-links";

// "What are you cutting?" One row per substrate that has a published blade.
// Substrates without approved swatch artwork get a plain neutral swatch.
export function MaterialIndex({ materials }: { materials: CatalogueView["materials"] }) {
  return (
    <section className={"materials frame" + (materials.length > 4 ? " is-long" : "")} id="materials" tabIndex={-1} aria-labelledby="materials-title">
      <div className="mat-copy">
        <p className="kicker">
          <span className="register" aria-hidden="true" />
          Material index
        </p>
        <h2 id="materials-title">
          What are
          <br /> you cutting?
        </h2>
        <p>Pick a substrate to see matching blades.</p>
      </div>
      <ul className="mat-list">
        {materials.map((material) => (
          <li key={material.slug}>
            <MaterialLink slug={material.slug}>
              <i className={"swatch " + (material.swatch ?? "plain")} aria-hidden="true" />
              <strong>{material.name}</strong>
              <span className="match-count">{bladeCount(material.count)}</span>
            </MaterialLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
