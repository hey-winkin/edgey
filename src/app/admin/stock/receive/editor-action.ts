"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/admin/auth";
import {
  deliveryCodeError, deliveryHeaderErrors, deliveryRowIds, editDeliveryRows, groupDeliveryMatches,
  makeDeliveryEditorState, readDeliveryDraft, readDeliveryRows, type EditorState, type ReviewedLine,
} from "@/lib/admin/delivery-editor-state";
import { deliveryToday, MAX_DELIVERY_IMPORT_BYTES, MAX_DELIVERY_ROWS } from "@/lib/admin/deliveries";
import { canManageCosts } from "@/lib/admin/stock-cost-data";
import { isWarehouseId } from "@/lib/admin/warehouse-format";
import { commitDelivery, findRecentDelivery, importDeliveryLines, lookupDeliveryCodes } from "./actions";

export async function runDeliveryEditor(previous: EditorState, form: FormData): Promise<EditorState | { recordedId: string }> {
  const { roles } = await requireStaff("warehouse");
  const showCosts = canManageCosts(roles);
  const intent = form.get("intent") ?? "review";
  if (intent === "commit" || intent === "back") {
    const review = previous?.review;
    if (!Array.isArray(review?.input?.lines) || !Array.isArray(previous.draft?.rows) ||
        (!showCosts && review.input.lines.some((line) => line?.unitCostPence !== null))) {
      return {
        ...makeDeliveryEditorState(randomUUID(), deliveryToday()),
        error: "This review is no longer available. Check delivery history before receiving stock.",
        errorAt: "receipt-review-error",
      };
    }
    const draft = showCosts ? previous.draft : {
      ...previous.draft, paste: "", rows: previous.draft.rows.map((row) => ({ ...row, unitCost: "" })),
    };
    if (intent === "back") {
      if (previous.retryOnly) return { ...previous, draft };
      return { draft, matches: previous.matches, checkedCodes: previous.checkedCodes, errorAt: "receipt-review" };
    }
    const result = await commitDelivery(review.input);
    if (result.ok) return { recordedId: result.id };
    return { ...previous, draft, error: result.error, retryOnly: previous.retryOnly || result.retryOnly, errorAt: "receipt-commit-error" };
  }

  const submitted = readDeliveryDraft(form, showCosts);
  if (!isWarehouseId(submitted.id)) submitted.id = randomUUID();
  if (new TextEncoder().encode(submitted.paste).byteLength > MAX_DELIVERY_IMPORT_BYTES) {
    return {
      draft: { ...submitted, paste: "" }, matches: [],
      error: "The pasted table exceeded 128 KB and could not be kept. Paste a smaller table.",
      errorAt: "receipt-import-error", importOpen: true,
    };
  }
  const edited = typeof intent === "string" ? editDeliveryRows(submitted, intent) : null;
  const draft = edited?.draft ?? submitted;
  const state: EditorState = { ...edited, draft, matches: [], importOpen: !!draft.paste.trim() };
  if (edited?.error) return state;

  if (intent === "import") {
    const result = await importDeliveryLines(form);
    if (!result.ok) return { ...state, error: result.error, errorAt: "receipt-import-error", importOpen: true };
    const existing = draft.rows.filter((row) => row.sourceRow || row.code.trim() || row.quantity.trim() || row.unitCost.trim());
    if (existing.length + result.rows.length > MAX_DELIVERY_ROWS) {
      return { ...state, error: `A delivery can have up to ${MAX_DELIVERY_ROWS} lines. Remove existing lines or import a smaller table.`,
        errorAt: "receipt-import-error", importOpen: true };
    }
    const allocateId = deliveryRowIds(draft.rows);
    const added = result.rows.map((row) => ({ ...row, id: allocateId() }));
    draft.rows = [...existing, ...added];
    draft.paste = "";
    state.importOpen = false;
    state.matches = result.matches;
    state.checkedCodes = [...new Set(added.map(({ code }) => code.trim()).filter((code) => !deliveryCodeError(code)))];
    state.errorAt = `receipt-${added[0]?.id}-code`;
    state.announcement = `${added.length} ${added.length === 1 ? "line" : "lines"} imported. Check the matched blades and quantities.`;
    const known = new Set(state.checkedCodes);
    const additional = [...new Set(existing.map(({ code }) => code.trim()).filter((code) => !known.has(code) && !deliveryCodeError(code)))];
    if (additional.length) {
      const matched = await lookupDeliveryCodes(additional);
      if (matched.ok) {
        state.matches.push(...matched.matches);
        state.checkedCodes.push(...additional);
      }
    }
    return state;
  }

  if (intent === "review") {
    const file = form.get("file");
    if (file instanceof File && file.size) {
      return { ...state, error: "Choose the CSV again and add its imported lines before reviewing the delivery.",
        errorAt: "receipt-import-error", importOpen: true };
    }
    if (draft.paste.trim()) {
      return { ...state, error: "Add the pasted lines or clear the pasted table before reviewing the delivery.",
        errorAt: "receipt-import-error", importOpen: true };
    }
    for (const [field, error] of Object.entries(deliveryHeaderErrors(draft))) {
      if (error) return { ...state, error, errorAt: `receipt-${field}` };
    }
  }
  const codes = [...new Set(draft.rows.map(({ code }) => code.trim()).filter((code) => !deliveryCodeError(code)))];
  if (codes.length) {
    const result = await lookupDeliveryCodes(codes);
    if (!result.ok) return { ...state, error: result.error, errorAt: "receipt-review-error" };
    state.matches = result.matches;
    state.checkedCodes = codes;
  }
  if (intent !== "review") return state;

  const lines: ReviewedLine[] = [];
  const checks = groupDeliveryMatches(codes, state.matches);
  for (const line of readDeliveryRows(draft.rows, checks, showCosts)) {
    if (!line.active) continue;
    const { row, match, quantity, unitCostPence, invalidCost, invalidCode, invalidMatch, duplicate } = line;
    if (!match || quantity === null || invalidCost || invalidCode || duplicate) {
      const field = invalidMatch ? "match" : invalidCode || duplicate || !match ? "code" : quantity === null ? "quantity" : "cost";
      return { ...state, error: "Check the marked lines before reviewing this delivery.", errorAt: `receipt-${row.id}-${field}` };
    }
    lines.push({ variantId: match.variantId, sku: match.sku, bladeName: match.bladeName, quantity, unitCostPence });
  }
  if (!lines.length) {
    return { ...state, error: "Add at least one delivery line.", errorAt: `receipt-${draft.rows[0]?.id}-code` };
  }
  const recent = await findRecentDelivery(draft.reference);
  return {
    ...state,
    errorAt: "receipt-review-heading",
    review: {
      input: {
        id: draft.id, reference: draft.reference.trim(), receivedOn: draft.receivedOn, note: draft.note.trim(),
        lines: lines.map(({ variantId, quantity, unitCostPence }) => ({ variantId, quantity, unitCostPence })),
      },
      lines,
      previous: recent,
    },
  };
}

export async function submitDeliveryEditor(previous: EditorState, form: FormData): Promise<EditorState> {
  const result = await runDeliveryEditor(previous, form);
  if ("recordedId" in result) redirect(`/admin/stock/deliveries/${result.recordedId}`);
  return result;
}
