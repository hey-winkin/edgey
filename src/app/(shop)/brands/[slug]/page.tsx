import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { brandHref, formatNumber, productHref, referenceToolFit } from "@/lib/catalogue";
import { formatPence, incVatLabel, PRICE_BREAKS } from "@/lib/catalogue/display-prices";
import { getBrandLanding } from "@/lib/catalogue/server";
import { siteUrl } from "@/lib/catalogue/site-url";
import styles from "./brand-page.module.css";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const landing = await getBrandLanding((await params).slug);
  if (!landing) return { title: "Brand references not found", robots: { index: false } };
  const { brand } = landing;
  return { title: `${brand.name} blade references`, alternates: { canonical: siteUrl(brandHref(brand.slug)) } };
}

export default async function BrandPage({ params }: Props) {
  const landing = await getBrandLanding((await params).slug);
  if (!landing) notFound();
  const { brand, blades } = landing;

  return <main id="main-content" tabIndex={-1} className={"frame " + styles.page}>
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link href="/blades">Blade catalogue</Link>
    </nav>
    <p className="kicker"><span className="register" aria-hidden="true" /> Verified references</p>
    <h1>{brand.name} blade references</h1>
    <p className={styles.intro}>Check the printed code against these Edgey blade references. Open the blade page to check the machine, tool or holder and any adapter before ordering.</p>
    <table className={styles.references} role="table" aria-labelledby="brand-references-caption">
      <caption id="brand-references-caption" className="sr">Published Edgey blades with verified {brand.name} references</caption>
      <thead className={styles.labels} role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">Edgey blade</th>
          <th scope="col" role="columnheader">Verified fit</th>
          <th scope="col" role="columnheader">Price and stock</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {blades.map(({ family, variant, references }) => {
          const media = variant.media ?? family.media;
          const tools = referenceToolFit(variant, references);
          const codes = [...new Set(references.map(({ code }) => code))];
          const priceBreak = PRICE_BREAKS.reduce((lowest, next) =>
            variant.prices[next.tier] < variant.prices[lowest.tier] ? next : lowest);
          const price = variant.prices[priceBreak.tier];
          return (
            <tr key={variant.id} role="row">
              <th scope="row" role="rowheader" className={styles.product}>
                <span className={styles.plate} aria-hidden="true">
                  {media.drawing ? (
                    <Image alt="" src={"/line-art/" + media.drawing} width={388} height={200} unoptimized />
                  ) : (
                    <code>{variant.sku}</code>
                  )}
                </span>
                <Link href={productHref(family.slug, family.variants.length > 1 ? variant.sku : null)}>
                  <code className={styles.sku}>{variant.sku}</code>{" "}
                  <span className="textlink">{family.name}</span>
                </Link>
              </th>
              <td role="cell">
                <dl className={styles.fit}>
                  <dt>OEM</dt>
                  <dd className={styles.codes}>{codes.map((code) => <code key={code}>{code} </code>)}</dd>
                  {tools.length > 0 && <><dt>Tool fit</dt><dd>{tools.join("; ")}</dd></>}
                  {variant.cuttingDepthMm !== null && <><dt>Cutting depth</dt><dd>{formatNumber(variant.cuttingDepthMm)} mm</dd></>}
                </dl>
              </td>
              <td role="cell">
                <p className={styles.price}>From <strong>{formatPence(price)}</strong> ex VAT / ea</p>
                <p className={styles.vat}>{incVatLabel(price)}</p>
                <p className={styles.quantity}>For {priceBreak.label} blades</p>
                <p className={styles.stock}>{variant.availability === "in_stock" ? "In stock" : "Out of stock"}</p>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </main>;
}
