import { formatNumber, productHref, referenceToolFit, type Compatibility, type Family } from "./index";

type ReferenceRow = {
  sku: string;
  name: string;
  href: string;
  codes: string[];
  machines: string[];
  heads: string[];
  angle: string | null;
  depth: string | null;
  materials: string[];
};

export type ReferenceGroup = { id: string; name: string; rows: ReferenceRow[] };

export function buildReferenceGuide(families: Family[]): ReferenceGroup[] {
  const groups = new Map<string, ReferenceGroup>();
  for (const family of families) {
    for (const variant of family.variants) {
      const referencesByBrand = new Map<string, Compatibility[]>();
      for (const reference of variant.compatibility) {
        const key = reference.brand?.slug ?? "";
        const references = referencesByBrand.get(key) ?? [];
        references.push(reference);
        referencesByBrand.set(key, references);
      }
      if (referencesByBrand.size === 0) referencesByBrand.set("", []);

      for (const [slug, references] of referencesByBrand) {
        const group = groups.get(slug) ?? {
          id: slug ? "brand-" + slug : "no-verified-brand",
          name: references[0]?.brand?.name ?? "No verified machine brand",
          rows: [],
        };
        group.rows.push({
          sku: variant.sku,
          name: family.name,
          href: productHref(family.slug, family.variants.length > 1 ? variant.sku : null),
          codes: [...new Set(references.map(({ code }) => code))],
          machines: [...new Set(references.flatMap(({ machine }) => machine ? [machine] : []))],
          heads: referenceToolFit({ ...variant, tool: null }, references),
          angle: variant.angleDeg === null ? null : formatNumber(variant.angleDeg) + "°",
          depth: variant.cuttingDepthMm === null ? null : formatNumber(variant.cuttingDepthMm) + " mm",
          materials: variant.substrates.map(({ name }) => name),
        });
        groups.set(slug, group);
      }
    }
  }

  const unassigned = groups.get("");
  groups.delete("");
  const branded = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  return unassigned ? [...branded, unassigned] : branded;
}

function searchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function filterReferenceGuide(groups: ReferenceGroup[], query: string): ReferenceGroup[] {
  const key = searchText(query.trim());
  if (!key) return groups;
  const terms = key.split(/\s+/);
  const compactKey = key.replace(/[\s-]/g, "");
  return groups.flatMap((group) => {
    const rows = group.rows.filter((row) => {
      const codes = [row.sku, ...row.codes];
      if (compactKey && codes.some((code) => searchText(code).replace(/[\s-]/g, "").includes(compactKey))) {
        return true;
      }
      const fields = [group.name, row.name, ...codes, ...row.machines, ...row.heads, ...row.materials, row.angle ?? "", row.depth ?? ""];
      const searchable = fields.map(searchText);
      return terms.every((term) => searchable.some((field) => field.includes(term)));
    });
    return rows.length ? [{ ...group, rows }] : [];
  });
}
