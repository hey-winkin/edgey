import type { PriceTiers } from "./display-prices";

export type Availability = "in_stock" | "out_of_stock";

export type Compatibility = {
  code: string;
  kind: "model" | "item_number" | "alias";
  brand: { slug: string; name: string } | null;
  machine: string | null;
  tool: string | null;
  adapter: string | null;
};

export type Substrate = { slug: string; name: string; swatch: string | null; sortOrder: number };

export type Variant = {
  id: string;
  sku: string;
  media?: Media;
  optionLabel: string | null;
  tool: string | null;
  angleDeg: number | null;
  shankMm: number | null;
  cuttingDepthMm: number | null;
  bladeThicknessMm: number | null;
  diameterMm: number | null;
  specs: Record<string, string>;
  prices: PriceTiers;
  availability: Availability;
  substrates: Substrate[];
  compatibility: Compatibility[];
};

export type Media = { drawing?: string; photo?: string; proof?: string };

export type Family = {
  id: string;
  familyCode: string;
  slug: string;
  name: string;
  description: string;
  toolType: { slug: string; name: string; sortOrder: number };
  media: Media;
  variants: Variant[];
};

export type SearchHit = {
  matchType: "exact" | "suggested";
  matchedCode: string | null;
  productSlug: string;
  sku: string;
};

export function familySubstrates(family: Family): Substrate[] {
  const bySlug = new Map<string, Substrate>();
  for (const variant of family.variants) for (const substrate of variant.substrates) bySlug.set(substrate.slug, substrate);
  return [...bySlug.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function familyBrands(family: Family): { slug: string; name: string }[] {
  const bySlug = new Map<string, { slug: string; name: string }>();
  for (const variant of family.variants)
    for (const record of variant.compatibility) if (record.brand) bySlug.set(record.brand.slug, record.brand);
  return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function referenceToolFit(variant: Variant, references = variant.compatibility): string[] {
  const tools = references.map(({ tool }) => tool).filter((tool): tool is string => Boolean(tool));
  const adapters = references.flatMap(({ adapter }) => adapter ? ["Adapter: " + adapter] : []);
  return [...new Set([...(tools.length ? tools : variant.tool ? [variant.tool] : []), ...adapters])];
}

// What tells one variant from a similar one: holder, angle, shank or size.
export function variantFit(variant: Variant, includeDimensions = true): string[] {
  const parts = [
    variant.tool,
    ...variant.compatibility.flatMap((record) =>
      [record.tool, record.adapter ? "Adapter: " + record.adapter : null],
    ),
  ].filter((part): part is string => Boolean(part));
  if (variant.angleDeg !== null) parts.push(formatNumber(variant.angleDeg) + "°");
  if (includeDimensions) {
    if (variant.shankMm !== null) parts.push(formatNumber(variant.shankMm) + " mm shank");
    if (variant.diameterMm !== null) parts.push(formatNumber(variant.diameterMm) + " mm diameter");
    if (variant.bladeThicknessMm !== null) parts.push(formatNumber(variant.bladeThicknessMm) + " mm thick");
    if (variant.cuttingDepthMm !== null) parts.push(formatNumber(variant.cuttingDepthMm) + " mm cutting depth");
  }
  return [...new Set(parts)];
}

export function variantLabel(variant: Variant): string {
  return variant.optionLabel ?? variantFit(variant)[0] ?? variant.sku;
}

export function variantChoiceCue(variant: Variant, variants: Variant[]): string | undefined {
  const otherVariants = variants.filter(({ sku }) => sku !== variant.sku);
  for (const field of ["Blade type", "Offset"] as const) {
    const value = variant.specs[field];
    const cue = typeof value === "string" ? value.trim() : "";
    if (cue && otherVariants.some((other) => {
      const otherValue = other.specs[field];
      const otherCue = typeof otherValue === "string" ? otherValue.trim() : "";
      return otherCue && otherCue !== cue;
    })) {
      return field === "Offset" ? "Offset: " + cue : cue;
    }
  }
  for (const [field, unit] of [["shankMm", "mm shank"], ["diameterMm", "mm diameter"], ["bladeThicknessMm", "mm thick"]] as const) {
    const value = variant[field];
    if (value !== null && otherVariants.some((other) => other[field] !== null && other[field] !== value)) {
      return formatNumber(value) + " " + unit;
    }
  }
}

// "Zünd Z10 / 3910301": the approved machine reference for a variant.
export function variantReference(variant: Variant): string | null {
  if (variant.compatibility.length === 0) return null;
  const groups = new Map<string, string[]>();
  for (const record of variant.compatibility) {
    const brand = record.brand?.name ?? "";
    const codes = groups.get(brand) ?? [];
    codes.push(record.code);
    groups.set(brand, codes);
  }
  return [...groups].map(([brand, codes]) => [brand, codes.join(" / ")].filter(Boolean).join(" ")).join(" · ");
}

export function formatNumber(value: number): string {
  return String(Number(value));
}

export type RouteQuery = Record<string, string | string[] | undefined>;

export type CatalogueFilters = { q: string; type: string; machine: string; material: string; depth: string; head: string };

type ToolHead = { slug: string; name: string; machines: string[] };

export function toolHeadsForMachine(heads: ToolHead[], machine: string): ToolHead[] {
  return machine ? heads.filter((head) => head.machines.includes(machine)) : heads;
}

export type CatalogueCard = {
  family: Family;
  match: "exact" | "suggested" | null;
  variants: Variant[];
  href: string;
  matchedCode: string | null;
};

export type CatalogueView = {
  cards: CatalogueCard[];
  toolTypes: { slug: string; name: string }[];
  machines: { slug: string; name: string }[];
  toolHeads: ToolHead[];
  materials: (Substrate & { count: number })[];
  activeMaterial: Substrate | null;
  missingDepthCount: number;
  filtered: boolean;
  finderEventId?: string;
};

export function buildCatalogueView(families: Family[], hits: SearchHit[] | null, filters: CatalogueFilters): CatalogueView {
  const toolTypes = new Map<string, { slug: string; name: string; sortOrder: number }>();
  const machines = new Map<string, { slug: string; name: string }>();
  const toolHeads = new Map<string, ToolHead>();
  const headsByReference = new Map<Compatibility, string[]>();
  const materials = new Map<string, Substrate & { count: number }>();
  for (const family of families) {
    toolTypes.set(family.toolType.slug, family.toolType);
    for (const brand of familyBrands(family)) machines.set(brand.slug, brand);
    for (const { compatibility } of family.variants) {
      for (const reference of compatibility) {
        const names = (reference.tool ?? "").split(/[,;]/).map((name) => queryValue(name, 160)).filter(Boolean);
        const slugs = names.map((name) => {
          const slug = name.toLowerCase();
          const head = toolHeads.get(slug) ?? { slug, name, machines: [] };
          if (reference.brand && !head.machines.includes(reference.brand.slug)) head.machines.push(reference.brand.slug);
          toolHeads.set(slug, head);
          return slug;
        });
        headsByReference.set(reference, slugs);
      }
    }
    for (const substrate of familySubstrates(family)) {
      const entry = materials.get(substrate.slug) ?? { ...substrate, count: 0 };
      entry.count += 1;
      materials.set(substrate.slug, entry);
    }
  }

  const minimumDepth = Number(filters.depth);
  const missingDepth = new Set<string>();
  function passesFilters(family: Family, variant: Variant) {
    if (filters.type && family.toolType.slug !== filters.type) return false;
    if (filters.material && !variant.substrates.some((substrate) => substrate.slug === filters.material)) return false;
    if ((filters.machine || filters.head) && !variant.compatibility.some((record) =>
      (!filters.machine || record.brand?.slug === filters.machine) &&
      (!filters.head || headsByReference.get(record)?.includes(filters.head))
    )) return false;
    if (!minimumDepth) return true;
    if (variant.cuttingDepthMm === null) {
      missingDepth.add(variant.id);
      return false;
    }
    return variant.cuttingDepthMm >= minimumDepth;
  }

  const bySlug = new Map(families.map((family) => [family.slug, family]));
  const grouped = new Map<string, CatalogueCard>();
  if (hits === null) {
    for (const family of families) {
      const variants = family.variants.filter((variant) => passesFilters(family, variant));
      if (variants.length) grouped.set(family.slug, { family, variants, match: null, matchedCode: null, href: productHref(family.slug) });
    }
  } else {
    for (const hit of hits) {
      const family = bySlug.get(hit.productSlug);
      const variant = family?.variants.find((candidate) => candidate.sku === hit.sku);
      if (!family || !variant || !passesFilters(family, variant)) continue;
      const card = grouped.get(family.slug) ?? {
        family, variants: [], match: hit.matchType, matchedCode: hit.matchedCode, href: productHref(family.slug),
      };
      if (hit.matchType === card.match) card.variants.push(variant);
      grouped.set(family.slug, card);
    }
  }

  const cards = [...grouped.values()].map((card) => {
    const only = card.variants.length === 1 ? card.variants[0] : undefined;
    const unambiguous = card.match === "exact" &&
      hits?.filter((hit) => hit.matchType === "exact" && hit.productSlug === card.family.slug).length === 1;
    return {
      ...card,
      href: productHref(card.family.slug, unambiguous && card.family.variants.length > 1 ? only?.sku : undefined),
    };
  });

  return {
    cards,
    toolTypes: [...toolTypes.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    machines: [...machines.values()].sort((a, b) => a.name.localeCompare(b.name)),
    toolHeads: [...toolHeads.values()].sort((a, b) => a.name.localeCompare(b.name)),
    materials: [...materials.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    activeMaterial: materials.get(filters.material) ?? null,
    missingDepthCount: missingDepth.size,
    filtered: Object.values(filters).some(Boolean),
  };
}

export function readFilters(params: RouteQuery, bladeFacets = false): CatalogueFilters {
  const one = (key: string) => queryValue(params[key]);
  const depth = bladeFacets ? one("depth") : "";
  const minimum = Number(depth);
  return {
    q: one("q"),
    type: one("type"),
    machine: one("machine"),
    material: one("material"),
    depth: /^(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(depth) && minimum > 0 && Number.isFinite(minimum) ? depth : "",
    head: bladeFacets ? queryValue(params.head, 160).toLowerCase() : "",
  };
}

export function bladeCount(count: number): string {
  return count + (count === 1 ? " blade" : " blades");
}

export function queryValue(value: string | string[] | undefined, maxLength = 80): string {
  return Array.from((Array.isArray(value) ? value[0] : value) ?? "", (character) => {
    if (/\s/.test(character)) return " ";
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? "" : character;
  }).join("").trim().slice(0, maxLength);
}

export function productHref(slug: string, sku?: string | null): string {
  return "/blades/" + slug + (sku ? "?variant=" + encodeURIComponent(sku) : "");
}

export function brandHref(slug: string): string {
  return "/brands/" + encodeURIComponent(slug);
}
