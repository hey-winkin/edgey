import { formatNumber, productHref, type Family } from "./index";

export const corrugatedSlug = "corrugated-board";
export const featuredFamilySlug = "edg-z16";

const coreStudies = [
  { material: corrugatedSlug, family: featuredFamilySlug, sku: "EDG-Z16", type: "oscillating", brand: "zund", caption: "An oscillating blade passes through the liners and fluted paper core." },
  { material: "vinyl", family: "edg-mim-45", sku: "EDG-MIM-A45", type: "roll-plotter", brand: "mimaki", caption: "The drawing shows the drag tip in the vinyl face, with the liner intact." },
  { material: "correx", family: "edg-sr6223", sku: "EDG-SR6223", type: "oscillating", brand: "kongsberg", caption: "The section shows the round-shank blade between the ribs of the sheet." },
  { material: "foamex", family: "edg-z10", sku: "EDG-Z10", type: "drag", brand: "zund", caption: "The cutaway shows a flat drag blade following the cut through the sheet." },
  { material: "textile", family: "edg-z50", sku: "EDG-Z50", type: "rotary", brand: "zund", caption: "A ten-sided rotary blade is shown passing over the weave." },
] as const;

const additionalStudies = [
  { material: "banner", family: "edg-z10", sku: "EDG-Z10", type: "drag", brand: "zund", caption: "A flat drag blade follows the cut through a flexible banner sheet." },
  { material: "flock", family: "edg-sum-drg", sku: "EDG-SUM-DRG-60", type: "roll-plotter", brand: "summa", caption: "The drag tip separates the short pile and its carrier layer." },
  { material: "foam-board", family: "edg-z16", sku: "EDG-Z16", type: "oscillating", brand: "zund", caption: "The section shows the pointed blade passing through the face and into the foam core." },
  { material: "honeycomb-board", family: "edg-z71", sku: "EDG-Z71", type: "v-cut", brand: "zund", caption: "The inclined blade traces one side of a V-groove through the open cells." },
  { material: "laminate", family: "edg-sum-drg", sku: "EDG-SUM-DRG-60", type: "roll-plotter", brand: "summa", caption: "The section brings the laminate layers and the drag tip into view." },
  { material: "pvc", family: "edg-z10", sku: "EDG-Z10", type: "drag", brand: "zund", caption: "The cutaway shows a flat drag blade cutting into a solid PVC sheet." },
  { material: "re-board", family: "edg-z71", sku: "EDG-Z71", type: "v-cut", brand: "zund", caption: "The blade sits on one side of a V-groove in the faced paper board." },
  { material: "reflective-film", family: "edg-mim-45", sku: "EDG-MIM-A60", type: "roll-plotter", brand: "mimaki", caption: "The drag tip follows the cut in the reflective face, above the liner." },
  { material: "soft-signage", family: "edg-z50", sku: "EDG-Z50", type: "rotary", brand: "zund", caption: "A ten-sided rotary blade cuts a printed textile panel for soft signage." },
] as const;

type StudyRule = (typeof coreStudies | typeof additionalStudies)[number];
export type AdditionalStudyMaterial = typeof additionalStudies[number]["material"];

const annotations = [
  ["length", "Blade length"],
  ["depth", "Cutting depth"],
  ["thickness", "Blade thickness"],
  ["angle", "Angle"],
  ["motion", "Motion"],
  ["range", "Material thickness range"],
  ["diameter", "Blade diameter"],
  ["shank", "Shank diameter"],
  ["width", "Blade width"],
  ["bore", "Bore diameter"],
] as const;

export type StudyAnnotation = typeof annotations[number][0];

function dimension(value: number | null, unit: string) {
  return value === null || !Number.isFinite(value) ? null : formatNumber(value) + unit;
}

function buildStudy(family: Family | null | undefined, rule: StudyRule, mode: "preview" | "core" | "additional") {
  if (family?.slug !== rule.family || family.toolType.slug !== rule.type) return null;
  const variant = family.variants.find(({ sku }) => sku === rule.sku);
  const material = variant?.substrates.find(({ slug }) => slug === rule.material);
  if (!variant || !material) return null;
  const motion = rule.type === "roll-plotter"
    ? (/\bdrag\b/i.test(variant.specs["Blade type"] ?? "") ? "Drag" : null)
    : rule.type === "v-cut" ? null : family.toolType.name.trim();
  if (rule.type === "roll-plotter" && !motion && (mode === "core" || variant.specs["Blade type"]?.trim())) return null;

  const featured = variant.compatibility.filter(({ brand }) => brand?.slug === rule.brand);
  const brand = featured[0]?.brand?.name ?? null;
  if (mode === "preview" && !brand) return null;

  const fits = new Map<string, { brand: string | null; machine: string | null; tool: string | null; adapter: string | null }>();
  for (const record of mode === "preview" ? featured : variant.compatibility) {
    const machine = record.machine?.trim() || null;
    const tool = record.tool?.trim() || null;
    const adapter = record.adapter?.trim() || null;
    const name = record.brand?.name ?? null;
    if (machine || tool || adapter) fits.set(JSON.stringify([name, machine, tool, adapter]), { brand: name, machine, tool, adapter });
  }

  const values = {
    length: variant.specs.Length?.trim(),
    depth: dimension(variant.cuttingDepthMm, " mm"),
    thickness: dimension(variant.bladeThicknessMm, " mm"),
    angle: dimension(variant.angleDeg, "°"),
    motion,
    range: variant.specs["Material thickness range"]?.trim(),
    diameter: rule.material === corrugatedSlug ? null : dimension(variant.diameterMm, " mm"),
    shank: rule.material === corrugatedSlug ? null : dimension(variant.shankMm, " mm"),
    width: mode === "additional" ? variant.specs.Width?.trim() : null,
    bore: mode === "additional" ? variant.specs["Bore diameter"]?.trim() : null,
  };

  return {
    material,
    sku: variant.sku,
    model: (featured.find(({ kind }) => kind === "model") ?? featured.find(({ kind }) => kind === "item_number"))?.code ?? null,
    brand,
    name: family.name,
    href: productHref(family.slug, family.variants.length > 1 ? variant.sku : null),
    caption: rule.caption,
    fits: [...fits.values()],
    annotations: annotations.flatMap(([key, label]) => {
      const value = values[key];
      const text = key === "angle" ? { preview: "Edge angle", core: label, additional: "Blade angle" }[mode] : label;
      return value ? [{ key, label: text, value }] : [];
    }),
  };
}

export function buildCorrugatedStudy(family: Family | null) {
  return buildStudy(family, coreStudies[0], "preview");
}

export type CorrugatedStudy = NonNullable<ReturnType<typeof buildCorrugatedStudy>>;

export type CuttingStudy = NonNullable<ReturnType<typeof buildStudy>> & { sharedReference: boolean };

function codeKey(code: string) {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function buildStudies(families: Family[], rules: readonly StudyRule[], mode: "core" | "additional"): CuttingStudy[] {
  return rules.flatMap((rule) => {
    const study = buildStudy(families.find(({ slug }) => slug === rule.family), rule, mode);
    if (!study) return [];
    const code = study.model ? codeKey(study.model) : "";
    const sharedReference = Boolean(code && families.some((family) => family.variants.some((variant) =>
      variant.sku !== study.sku && variant.compatibility.some((record) => codeKey(record.code) === code),
    )));
    return [{ ...study, sharedReference }];
  });
}

export function buildCoreStudies(families: Family[]) {
  return buildStudies(families, coreStudies, "core");
}

export function buildAdditionalStudies(families: Family[]) {
  return buildStudies(families, additionalStudies, "additional");
}
