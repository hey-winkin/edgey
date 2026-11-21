import type { Family, SearchHit } from "./index";

function modelKey(value: string) {
  return value.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function searchMachineModels(families: Family[], query: string): SearchHit[] {
  const key = modelKey(query);
  if (key.length < 2 || !/[a-z]/.test(key)) return [];

  return families.flatMap((family) => family.variants.flatMap((variant) => {
    const match = variant.compatibility.some(({ brand, machine }) => machine?.split(/[,;()]/).some((part) => {
      const model = modelKey(part);
      return model && (key === model || (brand && key === modelKey(brand.name) + model));
    }));
    return match ? [{ matchType: "suggested", matchedCode: null, productSlug: family.slug, sku: variant.sku }] : [];
  }));
}
