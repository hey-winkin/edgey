import { describe, expect, it } from "vitest";
import type { Family, Variant } from "@/lib/catalogue";
import { buildCoreStudies, buildCorrugatedStudy } from "@/lib/catalogue/material-hero";

const material = { slug: "corrugated-board", name: "Corrugated board", swatch: "flutes", sortOrder: 10 };
const reference = {
  code: "Z16",
  kind: "model",
  brand: { slug: "zund", name: "Zünd" },
  machine: "Test table",
  tool: "Test head",
  adapter: null,
} satisfies Variant["compatibility"][number];
const variant: Variant = {
  id: "fixture",
  sku: "EDG-Z16",
  optionLabel: null,
  tool: "Unmapped holder",
  angleDeg: 43,
  shankMm: null,
  cuttingDepthMm: 8.1,
  bladeThicknessMm: 0.8,
  diameterMm: null,
  specs: { Length: "28 mm", "Material thickness range": "2–6 mm" },
  prices: { oneToFour: 1000, fiveToNine: 900, tenPlus: 800 },
  availability: "in_stock",
  substrates: [material],
  compatibility: [
    reference,
    { ...reference, kind: "item_number", code: "ITEM" },
    { ...reference, brand: { slug: "other", name: "Other" }, machine: "Other machine" },
  ],
};
const family: Family = {
  id: "fixture",
  familyCode: "EDG-Z16",
  slug: "edg-z16",
  name: "Test blade",
  description: "",
  media: {},
  toolType: { slug: "oscillating", name: "Test oscillating category", sortOrder: 1 },
  variants: [variant],
};

describe("corrugated hero study", () => {
  it("uses the matching variant's specs, category and public compatibility", () => {
    const study = buildCorrugatedStudy({
      ...family,
      variants: [{ ...variant, id: "other", sku: "OTHER", angleDeg: 95 }, variant],
    });
    expect(study).toMatchObject({
      material,
      sku: "EDG-Z16",
      model: reference.code,
      brand: reference.brand.name,
      href: "/blades/edg-z16?variant=EDG-Z16",
      fits: [{ machine: reference.machine, tool: reference.tool, adapter: null }],
    });
    expect(study?.annotations.map(({ key, value }) => [key, value])).toEqual([
      ["length", "28 mm"], ["depth", "8.1 mm"], ["thickness", "0.8 mm"],
      ["angle", "43°"], ["motion", "Test oscillating category"], ["range", "2–6 mm"],
    ]);
  });

  it("omits missing dimensions, range and compatibility fields rather than guessing", () => {
    const study = buildCorrugatedStudy({
      ...family,
      variants: [{
        ...variant,
        angleDeg: null,
        cuttingDepthMm: null,
        bladeThicknessMm: null,
        specs: { Length: " " },
        compatibility: [{ ...reference, machine: null, tool: null }],
      }],
    });
    expect(study?.annotations.map(({ key }) => key)).toEqual(["motion"]);
    expect(study?.fits).toEqual([]);
    expect(study?.href).toBe("/blades/edg-z16");
  });

  it("does not substitute a different product or show a study when the mapping is absent", () => {
    expect(buildCorrugatedStudy(null)).toBeNull();
    expect(buildCorrugatedStudy({ ...family, toolType: { ...family.toolType, slug: "drag" } })).toBeNull();
    expect(buildCorrugatedStudy({ ...family, variants: [{ ...variant, sku: "OTHER" }] })).toBeNull();
    expect(buildCorrugatedStudy({ ...family, variants: [{ ...variant, substrates: [] }] })).toBeNull();
    expect(buildCorrugatedStudy({ ...family, variants: [{ ...variant, compatibility: [] }] })).toBeNull();
  });
});

describe("homepage cutting studies", () => {
  const vinyl = { ...material, slug: "vinyl", name: "Vinyl" };
  const mimaki = {
    ...reference, kind: "item_number",
    code: "SPB-0030", brand: { slug: "mimaki", name: "Mimaki" }, machine: "CG-AR", tool: null,
  } as const;
  const plotter = {
    ...family, slug: "edg-mim-45", toolType: { slug: "roll-plotter", name: "Roll plotter", sortOrder: 1 },
    variants: [{
      ...variant, sku: "EDG-MIM-A45", specs: { "Blade type": "Standard vinyl drag blade" }, diameterMm: 1.5,
      substrates: [vinyl], compatibility: [mimaki, { ...mimaki, code: "MD300V" }],
    }, { ...variant, sku: "EDG-MIM-A60", substrates: [vinyl] }],
  };

  it("preserves the corrugated default and uses the exact published vinyl variant and catalogue facts", () => {
    const studies = buildCoreStudies([plotter, family]);
    expect(studies.map(({ sku }) => sku)).toEqual(["EDG-Z16", "EDG-MIM-A45"]);
    expect(studies[1]).toMatchObject({
      material: vinyl, brand: "Mimaki", model: "SPB-0030", href: "/blades/edg-mim-45?variant=EDG-MIM-A45",
      sharedReference: false,
      fits: [{ brand: "Mimaki", machine: "CG-AR", tool: null, adapter: null }],
    });
    expect(studies[1]?.annotations).toEqual(expect.arrayContaining([
      { key: "motion", label: "Motion", value: "Drag" },
      { key: "diameter", label: "Blade diameter", value: "1.5 mm" },
      { key: "angle", label: "Angle", value: "43°" },
    ]));
  });

  it("flags codes shared across different public configurations, even if punctuation varies", () => {
    const [a45, a60] = plotter.variants;
    expect(buildCoreStudies([{
      ...plotter, variants: [a45!, { ...a60!, compatibility: [{ ...mimaki, code: "SPB 0030" }] }],
    }])[0]).toMatchObject({ sku: "EDG-MIM-A45", sharedReference: true });
  });

  it("never borrows another SKU or keeps an illustration after its substrate or motion changes", () => {
    const featured = plotter.variants[0]!;
    expect(buildCoreStudies([{ ...plotter, variants: plotter.variants.slice(1) }])).toEqual([]);
    expect(buildCoreStudies([{ ...plotter, variants: [{ ...featured, substrates: [] }] }])).toEqual([]);
    expect(buildCoreStudies([{ ...plotter, variants: [{ ...featured, specs: { "Blade type": "Rotary" } }] }])).toEqual([]);
  });
});
