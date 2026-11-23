import { expect, test } from "vitest";
import { buildCatalogueView, productHref, queryValue, readFilters, referenceToolFit, toolHeadsForMachine, variantChoiceCue, type Family, type Variant } from "@/lib/catalogue";
import { unitPricePence, withVatPence } from "@/lib/catalogue/display-prices";

const materials = ["vinyl", "textile"].map((slug, sortOrder) => ({ slug, name: slug, sortOrder, swatch: null }));
const variant = (sku: string, brand: string, material: (typeof materials)[number]): Variant => ({
  id: sku,
  sku,
  optionLabel: null,
  tool: null,
  angleDeg: null,
  shankMm: null,
  cuttingDepthMm: null,
  bladeThicknessMm: null,
  diameterMm: null,
  specs: {},
  prices: { oneToFour: 2250, fiveToNine: 1995, tenPlus: 1750 },
  availability: "in_stock",
  substrates: [material],
  compatibility: [{ code: "SHARED", kind: "item_number", brand: { slug: brand, name: brand }, machine: null, tool: null, adapter: null }],
});

const family: Family = {
  id: "family",
  familyCode: "EDG-DEMO",
  slug: "edg-demo",
  name: "Demo blade",
  description: "",
  toolType: { slug: "drag", name: "Drag", sortOrder: 0 },
  media: {},
  variants: [variant("EDG-A", "one", materials[0]!), variant("EDG-B", "two", materials[1]!)],
};

test("machine and material must match the same variant", () => {
  const mixed = buildCatalogueView([family], null, readFilters({ machine: "one", material: "textile" }));
  expect(mixed.cards).toEqual([]);
  const coherent = buildCatalogueView([family], null, readFilters({ machine: "one", material: "vinyl" }));
  expect(coherent.cards[0]?.variants.map(({ sku }) => sku)).toEqual(["EDG-A"]);
});

test("a filter does not silently preselect one configuration of a shared code", () => {
  const hits = family.variants.map(({ sku }) => ({
    matchType: "exact" as const,
    matchedCode: "SHARED",
    productSlug: family.slug,
    sku,
  }));
  const { cards } = buildCatalogueView([family], hits, readFilters({ q: "SHARED", machine: "one" }));
  expect(cards[0]?.href).toBe("/blades/edg-demo");
});

test("tool head options come from references and a brand and head must share a reference", () => {
  const blade = family.variants[0]!;
  const twoBrands = {
    ...blade,
    tool: "Unmapped tool",
    compatibility: [
      { ...blade.compatibility[0]!, tool: "UCT, SCT; DRT" },
      { ...family.variants[1]!.compatibility[0]!, tool: " EOT ; uct " },
    ],
  };
  const families = [{ ...family, variants: [twoBrands] }];
  const view = buildCatalogueView(families, null, readFilters({ machine: "two", head: "EOT" }, true));
  expect(view.cards[0]?.variants).toEqual([twoBrands]);
  expect(view.toolHeads.map(({ name }) => name)).toEqual(["DRT", "EOT", "SCT", "UCT"]);
  expect(toolHeadsForMachine(view.toolHeads, "two").map(({ name }) => name)).toEqual(["EOT", "UCT"]);
  expect(buildCatalogueView(families, null, readFilters({ machine: "two", head: "sct" }, true)).cards).toEqual([]);
});

test("depth is inclusive and counts distinct missing-depth options only after other filters", () => {
  const blade = family.variants[0]!;
  const matches = { ...blade, cuttingDepthMm: 4.8 };
  const missing = { ...blade, id: "missing", sku: "EDG-MISSING" };
  const notSearched = { ...blade, id: "not-searched", sku: "EDG-NOT-SEARCHED" };
  const tooShallow = { ...blade, id: "shallow", sku: "EDG-SHALLOW", cuttingDepthMm: 4.79 };
  const otherBrand = { ...family.variants[1]!, substrates: blade.substrates };
  const wrongMaterial = { ...blade, id: "wrong-material", sku: "EDG-WRONG-MATERIAL", substrates: family.variants[1]!.substrates };
  const wrongHead = { ...blade, id: "wrong-head", sku: "EDG-WRONG-HEAD" };
  const variants = [matches, missing, notSearched, tooShallow, otherBrand, wrongMaterial].map((item) => ({
    ...item,
    compatibility: item.compatibility.map((record) => ({ ...record, tool: "UCT" })),
  }));
  const otherTypeBlade = { ...variants[1]!, id: "other-type", sku: "EDG-OTHER-TYPE" };
  const otherType = { ...family, slug: "oscillating-fit", toolType: { slug: "oscillating", name: "Oscillating", sortOrder: 1 }, variants: [otherTypeBlade] };
  const families = [{ ...family, variants: [...variants, wrongHead] }, otherType];
  const hits = [matches, missing, missing, tooShallow, otherBrand, wrongMaterial, wrongHead].map(({ sku }) => ({
    productSlug: family.slug, sku, matchType: "suggested" as const, matchedCode: null,
  }));
  const view = buildCatalogueView(families, [...hits, { ...hits[1]!, productSlug: otherType.slug, sku: otherTypeBlade.sku }], readFilters({
    q: "demo", machine: "one", material: "vinyl", type: "drag", head: "uct", depth: "4.8",
  }, true));
  expect(view.cards[0]?.variants.map(({ sku }) => sku)).toEqual([matches.sku]);
  expect(view.missingDepthCount).toBe(1);
});

test("search counts missing depth only in the match group shown before applying depth", () => {
  const blade = family.variants[0]!;
  const suggestedMissing = { ...blade, id: "suggested-missing", sku: "EDG-SUGGESTED-MISSING" };
  const suggestedFit = { ...blade, id: "suggested-fit", sku: "EDG-SUGGESTED-FIT", cuttingDepthMm: 5 };
  const families = [{ ...family, variants: [blade, suggestedMissing, suggestedFit] }];
  const hits = [blade, suggestedMissing, suggestedFit].map(({ sku }, index) => ({
    productSlug: family.slug, sku, matchType: index ? "suggested" as const : "exact" as const, matchedCode: "DEMO",
  }));
  const filters = readFilters({ q: "demo", depth: "5" }, true);
  const view = buildCatalogueView(families, hits, filters);
  expect(view.missingDepthCount).toBe(1);
  expect(view.cards[0]?.match).toBe("suggested");
  expect(view.cards[0]?.variants).toEqual([suggestedFit]);

  const exactFit = { ...blade, cuttingDepthMm: 5 };
  families[0]!.variants[0] = exactFit;
  const exactView = buildCatalogueView(families, hits, filters);
  expect(exactView.missingDepthCount).toBe(0);
  expect(exactView.cards[0]?.variants).toEqual([exactFit]);
});

test("blade facets opt in to positive finite decimal depths and normalized heads", () => {
  for (const depth of ["", "0", "-2", "Infinity", "0x10", "1e999", "4 mm", "NaN"]) {
    expect(readFilters({ depth }, true).depth).toBe("");
  }
  expect(readFilters({ depth: ["4.80", "12"], head: " HF VibraCut " }, true))
    .toMatchObject({ depth: "4.80", head: "hf vibracut" });
  expect(readFilters({ depth: "4.8", head: "uct" })).toMatchObject({ depth: "", head: "" });
});

test("the displayed price applies each break to every blade and rounds VAT on the total", () => {
  const prices = { oneToFour: 2250, fiveToNine: 1995, tenPlus: 1750 };
  expect([1, 4, 5, 9, 10].map((quantity) => unitPricePence(prices, quantity))).toEqual([2250, 2250, 1995, 1995, 1750]);
  expect(withVatPence(unitPricePence(prices, 5) * 5)).toBe(11970);
  expect(withVatPence(1598)).toBe(1918);
});

test("verified fit deduplicates heads and adapters, with a fallback to the recorded variant tool", () => {
  const blade = { ...family.variants[0]!, tool: "HF VibraCut (6 mm adapter)" };
  const reference = { ...blade.compatibility[0]!, tool: "HF VibraCut", adapter: "6 mm" };
  expect(referenceToolFit(blade, [reference, { ...reference, code: "SECOND" }]))
    .toEqual(["HF VibraCut", "Adapter: 6 mm"]);
  expect(referenceToolFit(blade)).toEqual(["HF VibraCut (6 mm adapter)"]);
});

test("variant choice cues use distinguishing catalogue fields and do not infer use from the angle", () => {
  const a = { ...family.variants[0]!, angleDeg: 45, specs: { "Blade type": "Standard drag", Offset: "0.25 mm" }, diameterMm: 1.5 };
  const b = { ...family.variants[1]!, angleDeg: 60, specs: { "Blade type": "Wedge drag", Offset: "0.50 mm" }, diameterMm: 2 };
  expect(variantChoiceCue(a, [a, b])).toBe("Standard drag");
  expect(variantChoiceCue(a, [a, { ...b, specs: { ...b.specs, "Blade type": "Standard drag" } }])).toBe("Offset: 0.25 mm");
  expect(variantChoiceCue(a, [a, { ...b, specs: a.specs }])).toBe("1.5 mm diameter");
  expect(variantChoiceCue(a, [a, { ...b, specs: a.specs, diameterMm: 1.5 }])).toBeUndefined();
});

test("route inputs keep the first value, strip control characters and cap search length", () => {
  expect(queryValue(["  SPB\u0000\t0030  ", "unrelated"])).toBe("SPB 0030");
  expect(queryValue("\u0000\u007f")).toBe("");
  expect(queryValue("a".repeat(100))).toHaveLength(80);
  expect(productHref("a-family", "A / B")).toBe("/blades/a-family?variant=A%20%2F%20B");
});
