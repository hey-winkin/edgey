import { describe, expect, test } from "vitest";
import type { Compatibility, Family, Variant } from "@/lib/catalogue";
import { buildReferenceGuide, filterReferenceGuide } from "@/lib/catalogue/reference-guide";

const zund = { slug: "zund", name: "Zünd" };
const summa = { slug: "summa", name: "Summa" };
const mapping = (overrides: Partial<Compatibility>): Compatibility => ({
  code: "Z10", kind: "model", brand: zund, machine: "G3, S3", tool: "UCT", adapter: null, ...overrides,
});
const variant: Variant = {
  id: "first-id",
  sku: "EDG-FIRST",
  optionLabel: "Unused option",
  tool: "Default holder",
  angleDeg: 50,
  shankMm: null,
  cuttingDepthMm: 4.8,
  bladeThicknessMm: null,
  diameterMm: null,
  specs: { "Other compatible machines": "Unverified hidden model" },
  prices: { oneToFour: 1195, fiveToNine: 900, tenPlus: 750 },
  availability: "in_stock",
  substrates: [{ slug: "foamex", name: "Foamex", swatch: null, sortOrder: 0 }],
  compatibility: [
    mapping({}),
    mapping({ code: "3910301", kind: "item_number" }),
    mapping({ code: "500-9802", kind: "item_number", brand: summa, machine: "F-Series", tool: "Drag module", adapter: "6 mm sleeve" }),
  ],
};
const family: Family = {
  id: "family-id",
  familyCode: "EDG-FAMILY",
  slug: "edg-family",
  name: "Flat-stock drag blade",
  description: "Description not used by this guide",
  media: {},
  toolType: { slug: "drag", name: "Drag", sortOrder: 0 },
  variants: [variant, {
    ...variant, id: "second-id", sku: "EDG-SECOND", compatibility: [], availability: "out_of_stock",
    angleDeg: null, cuttingDepthMm: null, substrates: [],
  }],
};

describe("blade reference guide", () => {
  test("groups public mappings by brand, scopes fit to each brand and keeps unassigned variants", () => {
    const guide = buildReferenceGuide([family]);
    expect(guide.map(({ id, name }) => [id, name])).toEqual([
      ["brand-summa", "Summa"], ["brand-zund", "Zünd"], ["no-verified-brand", "No verified machine brand"],
    ]);
    expect(guide.map(({ rows }) => rows)).toEqual([
      [{
        sku: "EDG-FIRST", name: family.name, href: "/blades/edg-family?variant=EDG-FIRST",
        codes: ["500-9802"], machines: ["F-Series"], heads: ["Drag module", "Adapter: 6 mm sleeve"],
        angle: "50°", depth: "4.8 mm", materials: ["Foamex"],
      }],
      [{
        sku: "EDG-FIRST", name: family.name, href: "/blades/edg-family?variant=EDG-FIRST",
        codes: ["Z10", "3910301"], machines: ["G3, S3"], heads: ["UCT"],
        angle: "50°", depth: "4.8 mm", materials: ["Foamex"],
      }],
      [{
        sku: "EDG-SECOND", name: family.name, href: "/blades/edg-family?variant=EDG-SECOND",
        codes: [], machines: [], heads: ["Default holder"], angle: null, depth: null, materials: [],
      }],
    ]);
  });

  test("preserves brandless approved references and keeps links clean for single variants", () => {
    const guide = buildReferenceGuide([{
      ...family,
      variants: [{ ...variant, compatibility: [mapping({ tool: null }), mapping({ brand: null, code: "NO-BRAND" })] }],
    }]);
    expect(guide).toHaveLength(2);
    expect(guide[0]?.rows[0]).toMatchObject({ href: "/blades/edg-family", codes: ["Z10"], heads: [] });
    expect(guide[1]?.rows[0]).toMatchObject({ href: "/blades/edg-family", codes: ["NO-BRAND"] });
  });

  test("searches only visible fields, normalising printed codes, case and diacritics", () => {
    const guide = buildReferenceGuide([family]);
    expect(filterReferenceGuide(guide, "   ")).toBe(guide);
    expect(filterReferenceGuide(guide, " zUnD FoaMeX ")).toEqual([guide[1]]);
    expect(filterReferenceGuide(guide, "500 9802")).toEqual([guide[0]]);
    expect(filterReferenceGuide(guide, "edgsecond")).toEqual([guide[2]]);
    expect(filterReferenceGuide(guide, "f-series 4.8 mm")).toEqual([guide[0]]);
    expect(filterReferenceGuide(guide, "First 3910301")).toEqual([guide[1]]);
    for (const query of ["Unverified hidden model", "Unused option", "Description not used", "1195"]) {
      expect(JSON.stringify(guide)).not.toContain(query);
      expect(filterReferenceGuide(guide, query)).toEqual([]);
    }
  });
});
