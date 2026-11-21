import { expect, test } from "vitest";
import { buildCatalogueView, productHref, queryValue, readFilters, referenceToolFit, type Family, type Variant } from "@/lib/catalogue";
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

test("route inputs keep the first value, strip control characters and cap search length", () => {
  expect(queryValue(["  SPB\u0000\t0030  ", "unrelated"])).toBe("SPB 0030");
  expect(queryValue("\u0000\u007f")).toBe("");
  expect(queryValue("a".repeat(100))).toHaveLength(80);
  expect(productHref("a-family", "A / B")).toBe("/blades/a-family?variant=A%20%2F%20B");
});
