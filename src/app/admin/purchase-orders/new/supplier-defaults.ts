import { maxPartNumberLength, purchaseId, validDate, validPurchaseSupplierPart, type PurchaseCurrency, type PurchaseEditorState, type PurchaseHeader, type PurchaseLine } from "./editor-data";

export type PurchaseSupplierOption = {
  id: string;
  name: string;
  default_currency: PurchaseCurrency | null;
  lead_time_days: number | null;
};
export type SupplierAssociation = {
  variant_id: string;
  supplier_id: string;
  supplier_part_number: string | null;
  is_usual: boolean;
  updated_at: string;
};
type Rate = { value: string; number: string; ordered: string };
export const defaultFields = {
  supplier_id: "supplier", currency: "currency", expected_on: "expected", exchange_rate: "exchange",
} as const;
type DefaultField = typeof defaultFields[keyof typeof defaultFields];
export type PurchaseDefaults = {
  suppliers: PurchaseSupplierOption[];
  rates: Partial<Record<Exclude<PurchaseCurrency, "GBP">, Rate>>;
  associations: SupplierAssociation[];
  stockCurrency?: PurchaseCurrency;
  edited: Partial<Record<DefaultField, boolean>>;
};

export function expectedPurchaseDate(ordered: string, days: number | null | undefined): string {
  if (!validDate(ordered) || days == null || !Number.isSafeInteger(days) || days < 0) return "";
  const date = new Date(ordered);
  date.setUTCDate(date.getUTCDate() + days);
  const result = Number.isFinite(+date) ? date.toISOString().slice(0, 10) : "";
  return validDate(result) ? result : "";
}

export function purchaseRate(defaults: PurchaseDefaults | undefined, currency: PurchaseCurrency) {
  return currency === "GBP" ? undefined : defaults?.rates[currency];
}

export function purchaseAssociation(defaults: PurchaseDefaults | undefined, variant: string, supplier: string) {
  return defaults?.associations.find((association) =>
    association.variant_id === variant && association.supplier_id === supplier);
}

function partFor(line: PurchaseLine, defaults: PurchaseDefaults, supplier: string) {
  const part = purchaseAssociation(defaults, line.product.id, supplier)?.supplier_part_number;
  return line.partDrafts?.[supplier] ?? (part && validPurchaseSupplierPart(part) ? part : "");
}

export function applyPurchaseDefaults(state: PurchaseEditorState): PurchaseEditorState {
  const { defaults, lines } = state;
  if (!defaults) return state;
  const header = { ...state.header };
  if (state.status === "draft") {
    const eligible = lines.filter(({ product }) => product.status !== "archived");
    if (!defaults.edited.supplier) {
      const usual = new Map(defaults.associations.filter(({ is_usual }) => is_usual)
        .map(({ variant_id, supplier_id }) => [variant_id, supplier_id]));
      const shared = usual.get(eligible[0]?.product.id ?? "");
      header.supplier = shared && defaults.suppliers.some(({ id }) => id === shared) &&
        !lines.some(({ partDrafts }) => partDrafts?.[""]) &&
        eligible.every(({ product }) => usual.get(product.id) === shared) ? shared : "";
    }
    const supplier = defaults.suppliers.find(({ id }) => id === header.supplier);
    if (!defaults.edited.currency) header.currency = supplier?.default_currency ?? defaults.stockCurrency ?? "GBP";
    if (!defaults.edited.expected) header.expected = expectedPurchaseDate(header.ordered, supplier?.lead_time_days);
    if (!defaults.edited.exchange) header.exchange = purchaseRate(defaults, header.currency)?.value ?? "";
  }
  return {
    ...state,
    header,
    lines: lines.map((line) => ({
      ...line,
      supplierPart: partFor(line, defaults, header.supplier),
      rememberPart: header.supplier === state.header.supplier && line.rememberPart,
    })),
  };
}

export function readPurchaseDefaultEdits(defaults: PurchaseDefaults, previous: PurchaseHeader, header: PurchaseHeader, form: FormData) {
  const edited = { ...defaults.edited };
  for (const [name, key] of Object.entries(defaultFields)) {
    const field = key as DefaultField;
    const applied = form.get(`default:${name}`) ?? previous[field];
    if (form.get(`edited:${name}`) === "1" || header[field] !== applied) edited[field] = true;
  }
  return { ...defaults, edited };
}

export function readPurchasePartDraft(line: PurchaseLine, defaults: PurchaseDefaults, previousSupplier: string,
  supplier: string, value: string, form: FormData): PurchaseLine {
  const id = line.product.id;
  const postedScope = form.get("part_supplier");
  const scope = typeof postedScope === "string" && (!postedScope || purchaseId.test(postedScope)) ? postedScope : previousSupplier;
  const drafts = { ...line.partDrafts };
  const raw = form.get(`part_drafts:${id}`);
  if (typeof raw === "string" && raw.length <= 16_384 && raw.startsWith("{")) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
    for (const [key, part] of Object.entries(parsed)) {
      if ((!key || defaults.suppliers.some(({ id }) => id === key)) &&
          typeof part === "string" && part.length <= maxPartNumberLength + 1) drafts[key] = part;
    }
  }
  const editScope = form.get(`part_edit:${id}`);
  if (editScope === "none" || (typeof editScope === "string" && purchaseId.test(editScope))) {
    drafts[editScope === "none" ? "" : editScope] = value;
  } else if (value !== partFor({ ...line, partDrafts: drafts }, defaults, scope)) {
    drafts[scope] = value;
  }
  const unassigned = drafts[""];
  if (!scope && supplier && unassigned !== undefined) {
    drafts[supplier] ??= unassigned;
    delete drafts[""];
  }
  return { ...line, partDrafts: drafts,
    rememberPart: Boolean(supplier) && form.get(`remember:${id}`) === supplier };
}

export function purchaseRememberRequests(state: PurchaseEditorState) {
  const { defaults, lines, header: { supplier } } = state;
  if (!defaults || !supplier) return [];
  return lines.flatMap((line) => {
    if (!line.rememberPart || line.product.status === "archived") return [];
    const association = purchaseAssociation(defaults, line.product.id, supplier);
    const part = line.supplierPart.trim();
    const first = !defaults.associations.some(({ variant_id }) => variant_id === line.product.id);
    if (part ? part === association?.supplier_part_number : !first) return [];
    return [{ variant_id: line.product.id, expected_association_updated_at: association?.updated_at ?? null }];
  });
}
