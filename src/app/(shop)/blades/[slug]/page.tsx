import { getFamily } from "@/lib/catalogue/server";
import { siteUrl } from "@/lib/catalogue/site-url";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/product-detail";
import {
  brandHref,
  familyBrands,
  formatNumber,
  productHref,
  queryValue,
  variantLabel,
  type Family,
  type RouteQuery,
  type Variant,
} from "@/lib/catalogue";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RouteQuery>;
};

// Titles, descriptions and structured data are built only from what the public
// role can read: approved records of published variants.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const family = await getFamily((await params).slug);
  if (!family) return { title: "Blade not found", robots: { index: false } };
  const brands = familyBrands(family).map((brand) => brand.name);
  const models = modelCodes(family);
  const fits = models.length ? " for " + [brands.join(" and "), models.join(", ")].filter(Boolean).join(" ") : "";
  const title = family.familyCode + " " + family.name + fits;
  const description = family.description + " See verified fit, availability and UK trade price breaks.";
  const url = siteUrl(productHref(family.slug));
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: "website", url },
  };
}

export default async function ProductPage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const family = await getFamily(slug);
  if (!family) notFound();
  const initialSku = queryValue(query.variant);

  return (
    <main id="main-content" tabIndex={-1} className="frame product">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/blades">Blade catalogue</Link>
        <span aria-hidden="true">/</span>
        <Link href={"/blades?type=" + family.toolType.slug}>{family.toolType.name}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{family.familyCode}</span>
      </nav>
      <ProductDetail key={family.slug + (initialSku ?? "")} family={family} initialSku={initialSku} mode="page" />

      <div className="product-more">
        <div>
          <p className="kicker">
            <span className="register" aria-hidden="true" />
            Specification
          </p>
          <h2>Fit and technical detail</h2>
          <p className="muted">{family.description}</p>
        </div>
        <div>
          {family.variants.map((variant) => (
            <VariantSpecification key={variant.sku} family={family} variant={variant} />
          ))}
          <p className="fine">
            Not sure this is your blade?{" "}
            <Link className="textlink" href={"/enquiry?q=" + encodeURIComponent(family.familyCode)}>
              Ask us to match this blade
            </Link>
          </p>
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(family)).replace(/</g, "\\u003c") }} />
    </main>
  );
}

function VariantSpecification({ family, variant }: { family: Family; variant: Variant }) {
  const rows: [string, string][] = [["Edgey SKU", variant.sku], ["Tool type", family.toolType.name]];
  if (variant.tool) rows.push(["Tool or holder", variant.tool]);
  if (variant.angleDeg !== null) rows.push(["Angle", formatNumber(variant.angleDeg) + "°"]);
  if (variant.shankMm !== null) rows.push(["Shank", formatNumber(variant.shankMm) + " mm"]);
  if (variant.diameterMm !== null) rows.push(["Diameter", formatNumber(variant.diameterMm) + " mm"]);
  if (variant.bladeThicknessMm !== null) rows.push(["Blade thickness", formatNumber(variant.bladeThicknessMm) + " mm"]);
  if (variant.cuttingDepthMm !== null) rows.push(["Cutting depth", formatNumber(variant.cuttingDepthMm) + " mm"]);
  for (const [label, value] of Object.entries(variant.specs)) rows.push([label, value]);
  if (variant.substrates.length) rows.push(["Materials", variant.substrates.map((substrate) => substrate.name).join(", ")]);

  return (
    <>
      {family.variants.length > 1 && <h3>{variantLabel(variant)}</h3>}
      <dl className="specs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {variant.compatibility.length > 0 && (
        <div className="table-scroll mb-[26px]" role="region" tabIndex={0} aria-labelledby={variant.id + "-references"}>
          <table className="data-table">
            <caption id={variant.id + "-references"}>Verified references for {variant.sku}</caption>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Brand</th>
                <th scope="col">Machine</th>
                <th scope="col">Tool</th>
                <th scope="col">Adapter</th>
              </tr>
            </thead>
            <tbody>
              {variant.compatibility.map((record) => (
                <tr key={record.code}>
                  <th scope="row" className="code">
                    {record.code}
                  </th>
                  <td>{record.brand ? <Link className="textlink" href={brandHref(record.brand.slug)}>{record.brand.name}</Link> : "—"}</td>
                  <td>{record.machine ?? "—"}</td>
                  <td>{record.tool ?? "—"}</td>
                  <td>{record.adapter ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function modelCodes(family: Family): string[] {
  return [
    ...new Set(
      family.variants.flatMap((variant) =>
        variant.compatibility.filter((record) => record.kind === "model").map((record) => record.code),
      ),
    ),
  ];
}

// schema.org Product, or ProductGroup when the family has several variants.
// Prices are the business price: GBP excluding VAT, flagged as such.
function structuredData(family: Family) {
  const url = siteUrl(productHref(family.slug));
  const product = (variant: Variant) => ({
    "@type": "Product",
    name: family.name + (family.variants.length > 1 ? ", " + variantLabel(variant) : ""),
    sku: variant.sku,
    description: family.description,
    category: family.toolType.name + " blade",
    brand: { "@type": "Brand", name: "Edgey" },
    image: (variant.media ?? family.media).drawing ? siteUrl("/line-art/" + (variant.media ?? family.media).drawing) : undefined,
    additionalProperty: variant.compatibility.map((record) => ({
      "@type": "PropertyValue",
      name: "OEM reference",
      value: [record.brand?.name, record.code].filter(Boolean).join(" "),
    })),
    offers: {
      "@type": "Offer",
      url: siteUrl(productHref(family.slug, family.variants.length > 1 ? variant.sku : null)),
      priceCurrency: "GBP",
      price: (variant.prices.oneToFour / 100).toFixed(2),
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: (variant.prices.oneToFour / 100).toFixed(2),
        priceCurrency: "GBP",
        valueAddedTaxIncluded: false,
        eligibleQuantity: { "@type": "QuantitativeValue", minValue: 1, unitText: "blade" },
      },
      availability: "https://schema.org/" + (variant.availability === "in_stock" ? "InStock" : "OutOfStock"),
      itemCondition: "https://schema.org/NewCondition",
      eligibleCustomerType: "https://schema.org/Business",
      eligibleRegion: "GB",
    },
  });
  const only = family.variants.length === 1 ? family.variants[0] : undefined;
  if (only) return { "@context": "https://schema.org", ...product(only), url };
  return {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: family.name,
    description: family.description,
    productGroupID: family.familyCode,
    brand: { "@type": "Brand", name: "Edgey" },
    url,
    variesBy: ["Blade configuration"],
    hasVariant: family.variants.map(product),
  };
}
