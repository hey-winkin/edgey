import type { Family } from "./index";

export const siteTitle = "Edgey — The cutting room";
export const siteDescription =
  "Edgey’s digital cutting room. Explore replacement blades for print, packaging and display by tool type, material or part number.";
export const shareImageSize = { width: 1200, height: 630 };

export function productShareVariant(family: Family, sku: string) {
  return family.variants.find((variant) => variant.sku === sku) ?? family.variants[0];
}

export function socialMetadata(title: string, description: string, url?: string, product?: { slug: string; sku: string }) {
  const image = {
    url: product ? "/share-image?" + new URLSearchParams({ blade: product.slug, variant: product.sku }) : "/share-image",
    ...shareImageSize,
    alt: product ? title : siteTitle,
  };
  return {
    openGraph: { title, description, type: "website" as const, url, images: [image], siteName: "Edgey" },
    twitter: { card: "summary_large_image" as const, title, description, images: [image] },
  };
}
