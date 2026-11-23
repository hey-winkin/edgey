import {
  hasDeliveryControlCharacters, isDeliveryDate, MAX_DELIVERY_CODE_LENGTH, MAX_DELIVERY_IMPORT_BYTES,
  MAX_DELIVERY_ROWS, parseDeliveryCost, parseDeliveryQuantity,
  type DeliveryCommitInput, type DeliveryMatch,
} from "./deliveries";

export type EditorRow = {
  id: number;
  code: string;
  quantity: string;
  unitCost: string;
  sourceRow?: number;
  selectedId?: string;
};
export type DeliveryDraft = {
  id: string;
  reference: string;
  receivedOn: string;
  note: string;
  paste: string;
  rows: EditorRow[];
};
export type ReviewedLine = DeliveryCommitInput["lines"][number] & Pick<DeliveryMatch, "bladeName" | "sku">;
export type RecentDelivery = { ok: true; record: { id: string; receivedOn: string } | null } | { ok: false; error: string };
export type EditorState = {
  draft: DeliveryDraft;
  matches: DeliveryMatch[];
  checkedCodes?: string[];
  review?: { input: DeliveryCommitInput; lines: ReviewedLine[]; previous: RecentDelivery };
  error?: string;
  errorAt?: string;
  retryOnly?: boolean;
  announcement?: string;
  importOpen?: boolean;
};

type Check = DeliveryMatch[] | { error: string };

export function blankDeliveryRow(id: number): EditorRow {
  return { id, code: "", quantity: "", unitCost: "" };
}

export function makeDeliveryEditorState(id: string, today: string): EditorState {
  return { draft: { id, reference: "", receivedOn: today, note: "", paste: "", rows: [blankDeliveryRow(1)] }, matches: [] };
}

export function deliveryRowIds(rows: readonly EditorRow[]) {
  const occupied = new Set(rows.map(({ id }) => id));
  let next = 1;
  return () => {
    while (occupied.has(next)) next++;
    return next++;
  };
}

export function editDeliveryRows(draft: DeliveryDraft, intent: string): Pick<EditorState, "draft" | "error" | "errorAt" | "announcement"> | null {
  if (intent === "add") {
    if (draft.rows.length >= MAX_DELIVERY_ROWS) {
      return { draft, error: `A delivery can have at most ${MAX_DELIVERY_ROWS} lines.`, errorAt: "receipt-review-error" };
    }
    const id = deliveryRowIds(draft.rows)();
    return { draft: { ...draft, rows: [...draft.rows, blankDeliveryRow(id)] }, errorAt: `receipt-${id}-code` };
  }
  if (!intent.startsWith("remove:")) return null;
  const index = draft.rows.findIndex(({ id }) => intent === `remove:${id}`);
  if (index < 0) return { draft };
  const rows = draft.rows.filter((_, rowIndex) => rowIndex !== index);
  if (!rows.length) rows.push(blankDeliveryRow(deliveryRowIds(draft.rows)()));
  return {
    draft: { ...draft, rows },
    announcement: `Line ${index + 1} removed.`,
    errorAt: `receipt-${rows[Math.min(index, rows.length - 1)]?.id}-code`,
  };
}

export function deliveryCodeError(code: string) {
  if (!code) return "Enter a blade code.";
  if (code.length > MAX_DELIVERY_CODE_LENGTH || hasDeliveryControlCharacters(code)) return "Use a single blade code of up to 120 characters.";
  if (!/[a-z0-9]/i.test(code)) return "Include a letter or number from the blade code.";
}

export function deliveryHeaderErrors(draft: DeliveryDraft) {
  const reference = draft.reference.trim();
  return {
    reference: !reference ? "Enter a delivery reference."
      : reference.length > MAX_DELIVERY_CODE_LENGTH || hasDeliveryControlCharacters(reference)
        ? "Use a single reference of up to 120 characters." : undefined,
    date: !isDeliveryDate(draft.receivedOn) ? "Enter a received date of today or earlier." : undefined,
    note: draft.note.length > 500 || draft.note.includes("\0") ? "Use a note of up to 500 characters." : undefined,
  };
}

export function groupDeliveryMatches(codes: string[], matches: DeliveryMatch[]) {
  const grouped = new Map<string, Check>(codes.map((code) => [code, []]));
  for (const match of matches) {
    const list = grouped.get(match.inputCode);
    if (Array.isArray(list)) list.push(match);
  }
  return grouped;
}

export function readDeliveryRows(rows: EditorRow[], checks: Map<string, Check>, showCosts: boolean) {
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const code = row.code.trim();
    const active = Boolean(row.sourceRow || code || row.quantity.trim() || (showCosts && row.unitCost.trim()));
    const check = checks.get(code);
    const matches = Array.isArray(check) ? check : [];
    const match = matches.length === 1 ? matches[0] : matches.find(({ variantId }) => variantId === row.selectedId);
    const earlier = match && seen.get(match.variantId);
    if (match && earlier === undefined) seen.set(match.variantId, index + 1);
    const quantity = parseDeliveryQuantity(row.quantity);
    const unitCostPence = showCosts ? parseDeliveryCost(row.unitCost) : null;
    const invalidCode = active && (deliveryCodeError(code)
      || (check && !Array.isArray(check) ? check.error : undefined)
      || (check && matches.length === 0 ? "No match. Check the code or enter the exact SKU." : undefined));
    const invalidMatch = matches.length > 1 && !match;
    const duplicate = earlier ? `Same blade as line ${earlier}. Combine the quantities and remove this line.` : undefined;
    const invalidCost = showCosts && Boolean(row.unitCost.trim()) && unitCostPence === null;
    const ready = Boolean(active && match && !invalidCode && !duplicate && quantity !== null && !invalidCost);
    return { row, active, match, matches, quantity, unitCostPence, invalidCode, invalidMatch, duplicate, invalidCost, ready };
  });
}

export function readDeliveryDraft(form: FormData, showCosts: boolean): DeliveryDraft {
  function text(name: string, max: number) {
    const value = form.get(name);
    return typeof value === "string" ? value.slice(0, max + 1) : "";
  }
  const ids = [...new Set(form.getAll("row").flatMap((value) =>
    typeof value === "string" && /^[1-9]\d{0,6}$/.test(value) ? [Number(value)] : [],
  ))].slice(0, MAX_DELIVERY_ROWS);
  const rows = ids.map((id) => {
    const code = text(`code:${id}`, MAX_DELIVERY_CODE_LENGTH);
    const sourceRow = text(`sourceRow:${id}`, 6);
    return {
      id, code,
      quantity: text(`quantity:${id}`, MAX_DELIVERY_CODE_LENGTH),
      unitCost: showCosts ? text(`unitCost:${id}`, MAX_DELIVERY_CODE_LENGTH) : "",
      sourceRow: /^[1-9]\d{0,5}$/.test(sourceRow) ? Number(sourceRow) : undefined,
      selectedId: text(`selectedCode:${id}`, MAX_DELIVERY_CODE_LENGTH) === code.trim()
        ? text(`selectedId:${id}`, 36) || undefined : undefined,
    };
  });
  return {
    id: text("deliveryId", 36),
    reference: text("reference", MAX_DELIVERY_CODE_LENGTH),
    receivedOn: text("receivedOn", 10),
    note: text("note", 500),
    paste: text("paste", MAX_DELIVERY_IMPORT_BYTES),
    rows: rows.length ? rows : [blankDeliveryRow(1)],
  };
}
