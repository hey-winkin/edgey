"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffSession } from "@/lib/admin/auth";
import {
  DELIVERY_QUANTITY_MAX, hasDeliveryControlCharacters, isDeliveryDate, MAX_DELIVERY_CODE_LENGTH,
  MAX_DELIVERY_IMPORT_BYTES, MAX_DELIVERY_ROWS, type DeliveryCommitInput, type DeliveryMatch,
} from "@/lib/admin/deliveries";
import { parseDeliveryTable } from "@/lib/admin/delivery-import";
import type { PurchaseReceiptTarget } from "@/lib/admin/purchase-orders";
import { canManageCosts, stockSchemaUnavailable } from "@/lib/admin/stock-cost-data";

const referenceSchema = z.string().trim().min(1).max(MAX_DELIVERY_CODE_LENGTH)
  .refine((code) => !hasDeliveryControlCharacters(code));
const codeSchema = referenceSchema.refine((code) => /[A-Za-z0-9]/.test(code));
const commitSchema = z.strictObject({
  id: z.guid(),
  reference: referenceSchema,
  receivedOn: z.string().refine(isDeliveryDate),
  note: z.string().trim().max(500).refine((note) => !note.includes("\0")),
  lines: z.array(z.strictObject({
    variantId: z.guid().transform((id) => id.toLowerCase()),
    quantity: z.number().int().min(1).max(DELIVERY_QUANTITY_MAX),
    unitCostPence: z.number().int().min(0).max(DELIVERY_QUANTITY_MAX).nullable(),
  })).min(1).max(MAX_DELIVERY_ROWS),
});

function fail(error: string) {
  return { ok: false, error } as const;
}

async function matchCodes(db: NonNullable<Awaited<ReturnType<typeof staffSession>>>["db"], codes: string[]):
  Promise<{ ok: true; matches: DeliveryMatch[] } | ReturnType<typeof fail>> {
  if (!codes.length) return { ok: true, matches: [] } as const;
  const { data, error } = await db.rpc("match_staff_delivery_codes", { p_codes: [...new Set(codes)] });
  if (error) return fail(stockSchemaUnavailable(error)
    ? "Delivery receiving is not available yet. Use Stock to receive individual blades."
    : "Could not check blade codes. Try again.");
  return {
    ok: true,
    matches: data.map(({ input_code, variant_id, sku, blade_name }) => ({
      inputCode: input_code, variantId: variant_id, sku, bladeName: blade_name,
    })),
  } as const;
}

export async function lookupDeliveryCodes(codes: string[]) {
  const staff = await staffSession();
  if (!staff?.roles.includes("warehouse")) return fail("Warehouse access is required to receive a delivery.");
  const parsed = z.array(codeSchema).max(MAX_DELIVERY_ROWS).safeParse(codes);
  if (!parsed.success) return fail("Enter a blade code of up to 120 characters on each line.");
  return matchCodes(staff.db, parsed.data);
}

export async function findRecentDelivery(reference: string) {
  const staff = await staffSession();
  if (!staff?.roles.includes("warehouse")) return fail("Warehouse access is required to receive a delivery.");
  const parsed = referenceSchema.safeParse(reference);
  if (!parsed.success) return fail("Enter a delivery reference.");
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await staff.db.from("staff_deliveries").select("id,received_on")
    .eq("reference", parsed.data).gte("received_at", weekAgo)
    .order("received_at", { ascending: false }).order("id", { ascending: false })
    .limit(1).maybeSingle();
  if (error) return fail("Could not check Delivery history for this reference. Check history before receiving stock.");
  return { ok: true, record: data && { id: data.id, receivedOn: data.received_on } } as const;
}

export async function importDeliveryLines(form: FormData) {
  const staff = await staffSession();
  if (!staff?.roles.includes("warehouse")) return fail("Warehouse access is required to receive a delivery.");
  if (!(form instanceof FormData) || form.getAll("paste").length > 1 || form.getAll("file").length > 1) {
    return fail("Choose either a CSV file or a pasted table.");
  }
  const paste = form.get("paste");
  const upload = form.get("file");
  const file = upload instanceof File && upload.size > 0 ? upload : null;
  const pastedText = typeof paste === "string" ? paste : "";
  if (file && pastedText.trim()) return fail("Choose either a CSV file or a pasted table.");
  if (file && !file.name.toLowerCase().endsWith(".csv")) return fail("Choose a CSV file ending in .csv.");
  if ((file?.size ?? 0) > MAX_DELIVERY_IMPORT_BYTES) return fail("Use a CSV file no larger than 128 KB.");

  let text = pastedText;
  if (file) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      return fail("Save your spreadsheet as a UTF-8 CSV and try again.");
    }
  }
  const parsed = parseDeliveryTable(text, { csvOnly: !!file, canManageCosts: canManageCosts(staff.roles) });
  if (!parsed.ok) return parsed;
  const matched = await matchCodes(staff.db, parsed.rows.map(({ code }) => code).filter((code) => codeSchema.safeParse(code).success));
  return matched.ok ? { ...matched, rows: parsed.rows } : matched;
}

export async function commitDelivery(input: DeliveryCommitInput) {
  const refused = (message: string, retryOnly = false) => ({ ...fail(message), retryOnly });
  const staff = await staffSession();
  if (!staff?.roles.includes("warehouse")) return refused("Warehouse access is required to receive a delivery.", true);
  const parsed = commitSchema.safeParse(input);
  if (!parsed.success) return refused("Check the delivery details and quantities before receiving stock.");
  const { id, reference, receivedOn, note, lines } = parsed.data;
  if (lines.some(({ unitCostPence }) => unitCostPence !== null) && !canManageCosts(staff.roles)) {
    return refused("Your staff role cannot enter costs.", true);
  }
  if (new Set(lines.map(({ variantId }) => variantId)).size !== lines.length) {
    return refused("Use one line per blade. Combine duplicate quantities before receiving stock.");
  }
  const { data, error } = await staff.db.rpc("receive_staff_delivery", {
    p_delivery_id: id, p_reference: reference, p_received_on: receivedOn, p_note: note,
    p_lines: lines.map(({ variantId, quantity, unitCostPence }) => ({
      variant_id: variantId, quantity, unit_cost_pence: unitCostPence,
    })),
  });
  if (error) {
    if (stockSchemaUnavailable(error)) return refused("Delivery receiving is not available yet. No stock was received.");
    if (error.code === "22003" || error.message === "delivery_stock_overflow") {
      return refused("A quantity would put a blade over its stock limit. Check the quantities.");
    }
    if (error.code === "42501") return refused("Your staff access has changed. Check your roles before trying again.", true);
    if (error.message === "operation_key_conflict") {
      return refused("This delivery may already be recorded. Check delivery history before trying again.", true);
    }
    if (error.code === "22023") return refused("No stock was received. Go back and check the delivery lines and details.");
    return refused("Could not confirm that stock was received. Retry this review or check delivery history before starting again.", true);
  }
  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/deliveries");
  return { ok: true, id: data } as const;
}

export async function commitPurchaseDelivery(target: Pick<PurchaseReceiptTarget, "id" | "revision">, input: DeliveryCommitInput) {
  const refused = (message: string, retryOnly = false) => ({ ...fail(message), retryOnly });
  const staff = await staffSession();
  if (!staff?.roles.includes("warehouse")) return refused("Warehouse access is required to receive a delivery.", true);
  const parsed = commitSchema.safeParse(input);
  if (!z.guid().safeParse(target?.id).success || !Number.isInteger(target?.revision) || target.revision < 1 ||
      !parsed.success || parsed.data.lines.some(({ unitCostPence }) => unitCostPence !== null)) {
    return refused("Check the purchase order and the quantities received.");
  }
  const { id, reference, receivedOn, note, lines } = parsed.data;
  const { data, error } = await staff.db.rpc("receive_staff_purchase_order", {
    p_order_id: target.id, p_expected_revision: target.revision, p_delivery_id: id, p_reference: reference,
    p_received_on: receivedOn, p_note: note, p_lines: lines.map(({ variantId, quantity }) => ({ variant_id: variantId, quantity })),
  });
  if (error) {
    if (error.message === "purchase_order_stale") return refused("The purchase order changed. Reopen it to check what is still outstanding before receiving stock.");
    if (error.message === "purchase_order_not_receivable") return refused("This purchase order is no longer open for receiving.");
    if (error.message === "operation_key_conflict") return refused("This delivery may already be recorded. Check delivery history before trying again.", true);
    if (error.message === "delivery_stock_overflow") return refused("A quantity would put a blade over its stock limit. Check the quantities.");
    if (error.message === "delivery_variant_unavailable") return refused("A blade is no longer available to receive. Set its quantity to zero or ask the buyer to review the order.");
    if (error.code === "42501") return refused("Your staff access has changed. Check your roles before trying again.", true);
    if (stockSchemaUnavailable(error)) return refused("Purchase-order receiving is not available yet. No stock was received.");
    if (error.code === "22023") return refused("No stock was received. Check the purchase order and the delivery lines.");
    return refused("Could not confirm that stock was received. Retry this review or check delivery history before starting again.", true);
  }
  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/deliveries");
  revalidatePath("/admin/purchase-orders");
  revalidatePath(`/admin/purchase-orders/${target.id}`);
  revalidatePath("/admin/catalogue");
  return { ok: true, id: data } as const;
}
