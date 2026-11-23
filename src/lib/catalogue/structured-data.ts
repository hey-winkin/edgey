import { PRICE_BREAKS, withVatPence } from "./display-prices";
import { productHref, type Family, type Variant } from "./index";

export function productStructuredData(family: Family, selected: Variant | undefined, resolveUrl: (path: string) => string | undefined) {
  const single = selected ?? (family.variants.length === 1 ? family.variants[0] : undefined);
  const product = (variant: Variant, showOffer: boolean) => {
    const url = productHref(family.slug, family.variants.length > 1 ? variant.sku : null);
    return {
      "@type": "Product",
      name: family.name,
      sku: variant.sku,
      url: resolveUrl(url) ?? url,
      offers: !showOffer ? undefined : {
        "@type": "Offer",
        availability: "https://schema.org/" + (variant.availability === "in_stock" ? "InStock" : "OutOfStock"),
        priceSpecification: PRICE_BREAKS.flatMap(({ from, tier }, index) => {
          const next = PRICE_BREAKS[index + 1];
          return [false, true].map((includesVat) => ({
            "@type": "UnitPriceSpecification",
            price: ((includesVat ? withVatPence(variant.prices[tier]) : variant.prices[tier]) / 100).toFixed(2),
            priceCurrency: "GBP",
            valueAddedTaxIncluded: includesVat,
            referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitText: "blade" },
            eligibleQuantity: {
              "@type": "QuantitativeValue",
              minValue: from,
              maxValue: next ? next.from - 1 : undefined,
              unitText: "blade",
            },
          }));
        }),
      },
    };
  };
  return {
    "@context": "https://schema.org",
    ...(single ? product(single, true) : {
      "@type": "ProductGroup",
      name: family.name,
      productGroupID: family.familyCode,
      hasVariant: family.variants.map((variant) => product(variant, false)),
    }),
  };
}
