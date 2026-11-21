import { formatNumber, productHref, type Family } from "./index";

export const corrugatedSlug = "corrugated-board";
export const featuredFamilySlug = "edg-z16";

const annotations = [
  ["length", "Blade length"],
  ["depth", "Cutting depth"],
  ["thickness", "Blade thickness"],
  ["angle", "Edge angle"],
  ["motion", "Motion"],
  ["range", "Material thickness range"],
] as const;

function dimension(value: number | null, unit: string) {
  return value === null || !Number.isFinite(value) ? null : formatNumber(value) + unit;
}

export function buildCorrugatedStudy(family: Family | null) {
  if (family?.slug !== featuredFamilySlug || family.toolType.slug !== "oscillating") return null;
  const variant = family.variants.find(({ sku }) => sku === "EDG-Z16");
  const material = variant?.substrates.find(({ slug }) => slug === corrugatedSlug);
  if (!variant || !material) return null;

  const references = variant.compatibility.filter(({ brand }) => brand?.slug === "zund");
  const brand = references[0]?.brand?.name;
  if (!brand) return null;

  const fits = new Map<string, { machine: string | null; tool: string | null; adapter: string | null }>();
  for (const record of references) {
    const machine = record.machine?.trim() || null;
    const tool = record.tool?.trim() || null;
    const adapter = record.adapter?.trim() || null;
    if (machine || tool || adapter) fits.set(JSON.stringify([machine, tool, adapter]), { machine, tool, adapter });
  }

  const values = {
    length: variant.specs.Length?.trim(),
    depth: dimension(variant.cuttingDepthMm, " mm"),
    thickness: dimension(variant.bladeThicknessMm, " mm"),
    angle: dimension(variant.angleDeg, "°"),
    motion: family.toolType.name.trim(),
    range: variant.specs["Material thickness range"]?.trim(),
  };

  return {
    material,
    sku: variant.sku,
    model: references.find(({ kind }) => kind === "model")?.code ?? null,
    brand,
    name: family.name,
    href: productHref(family.slug, family.variants.length > 1 ? variant.sku : null),
    fits: [...fits.values()],
    annotations: annotations.flatMap(([key, label]) => {
      const value = values[key];
      return value ? [{ key, label, value }] : [];
    }),
  };
}

export type CorrugatedStudy = NonNullable<ReturnType<typeof buildCorrugatedStudy>>;
