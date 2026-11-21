import Image from "next/image";
import Link from "next/link";
import { useId } from "react";
import { formatNumber, referenceToolFit, type CatalogueCard, type Variant } from "@/lib/catalogue";
import { formatPence, incVatLabel } from "@/lib/catalogue/display-prices";
import styles from "./product-card.module.css";

// One card per family: neutral plate, diagonal proof crop, line drawing.
// A family without approved artwork shows its part code on the plain plate.
export function ProductCard({ card }: { card: CatalogueCard }) {
  const id = useId();
  const { family, match, variants, matchedCode } = card;
  const media = variants[0]?.media ?? family.media;
  const lowest = Math.min(...variants.map((variant) => variant.prices.oneToFour));
  const priceVaries = variants.some((variant) => variant.prices.oneToFour !== lowest);
  const references = new Map<string, Set<string>>();
  const fit = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const record of variant.compatibility) {
      const brand = record.brand?.name ?? "";
      const codes = references.get(brand) ?? new Set<string>();
      codes.add(record.code);
      references.set(brand, codes);
    }
    const tools = referenceToolFit(variant).join("; ");
    const options = fit.get(tools) ?? new Set<string>();
    const specs = keySpecs(variant);
    if (specs) options.add(specs);
    fit.set(tools, options);
  }
  const inStock = variants.filter(({ availability }) => availability === "in_stock").length;
  const stock = inStock === variants.length ? "In stock" : inStock === 0 ? "Out of stock" : "Some options out of stock";

  return (
    <div className={"p-card " + styles.card} data-proof={media.drawing ? media.proof : undefined}>
      <span className="p-card-image">
        {media.drawing ? (
          <Image alt="" src={"/line-art/" + media.drawing} width={388} height={200} unoptimized />
        ) : (
          <span className="plate-code" aria-hidden="true">{family.familyCode}</span>
        )}
      </span>
      <span className="p-card-info">
        {match && (
          <span id={id + "-match"} className="p-card-match">
            {match === "exact" ? "Exact match" : "Suggested"}
            {matchedCode && <> · <span className={"printed-code " + styles.code}>{matchedCode}</span></>}
          </span>
        )}
        <Link
          className={styles.link}
          href={card.href}
          scroll={false}
          aria-describedby={[match && id + "-match", id + "-fit", id + "-price"].filter(Boolean).join(" ")}
        >
          <span className="p-card-code">{family.familyCode}</span>{" "}
          <span className="p-card-name">{family.name}</span>
        </Link>
        <span id={id + "-fit"} className={styles.metadata}>
          {[...references].map(([brand, codes]) => (
            <span className={styles.reference} key={brand}>
              {brand && <b>{brand} </b>}
              {[...codes].map((code) => <code className={styles.code} key={code}>{code} </code>)}
            </span>
          ))}
          {match === "exact" && variants.length > 1 && <span>{variants.length} configurations</span>}
          {[...fit].map(([tools, options]) => (tools || options.size > 0) && (
            <span className={styles.fit} key={tools}>
              {tools && <span>{tools}</span>}
              {options.size > 0 && <span>{[...options].join(" or ")}</span>}
            </span>
          ))}
          <span className={styles.stock}>{stock}</span>
        </span>
        <span className="p-card-foot">
          <span id={id + "-price"}>
            {priceVaries && "From "}
            <b>{formatPence(lowest)}</b> ex VAT / ea
            <span className="p-card-vat">{incVatLabel(lowest)}</span>
          </span>
          <span className="open-icon" aria-hidden="true" />
        </span>
      </span>
    </div>
  );
}

function keySpecs(variant: Variant): string {
  const { optionLabel, angleDeg, cuttingDepthMm, shankMm, diameterMm, bladeThicknessMm } = variant;
  const dimension = cuttingDepthMm !== null ? formatNumber(cuttingDepthMm) + " mm cutting depth"
    : shankMm !== null ? formatNumber(shankMm) + " mm shank"
    : diameterMm !== null ? formatNumber(diameterMm) + " mm diameter"
    : bladeThicknessMm !== null ? formatNumber(bladeThicknessMm) + " mm thick"
    : null;
  return [optionLabel ?? (angleDeg !== null ? formatNumber(angleDeg) + "°" : null), dimension].filter(Boolean).join(" · ");
}
