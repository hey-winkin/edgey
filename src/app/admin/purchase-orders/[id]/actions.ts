"use server";

import { revalidatePath } from "next/cache";
import type { AdminResult } from "@/app/admin/form";
import { requireStaff } from "@/lib/admin/auth";
import { isWarehouseId } from "@/lib/admin/warehouse-format";

const transitionErrors: Record<string, string> = {
  staff_purchase_order_revision_conflict: "This order changed. Reload it and check its latest details.",
  staff_purchase_order_incomplete: "Choose a supplier and complete the quantities, prices, exchange rate and tax settings before marking this order sent.",
  staff_purchase_order_invalid_transition: "The order can’t move to that status. Reload it to check its current status.",
  staff_purchase_cost_overflow: "The calculated cost is too large. Check the prices, exchange rate and extra costs.",
};

export async function transitionPurchaseOrder(id: string, revision: number, status: "sent" | "closed" | "cancelled",
  _previous: AdminResult | null, form: FormData): Promise<AdminResult> {
  const { db } = await requireStaff("catalogue", "finance");
  if (!isWarehouseId(id) || !Number.isInteger(revision) || revision < 1 || !["sent", "closed", "cancelled"].includes(status)) {
    return { ok: false, message: "This purchase order could not be updated." };
  }
  if (status !== "sent" && form.get("confirm") !== "yes") return { ok: false, message: "Confirm the change before continuing." };
  const { error } = await db.rpc("transition_staff_purchase_order", {
    p_id: id, p_expected_revision: revision, p_status: status,
  });
  if (error) return { ok: false, message: transitionErrors[error.message] ?? "Could not change the purchase order status." };
  revalidatePath("/admin/purchase-orders");
  revalidatePath(`/admin/purchase-orders/${id}`);
  revalidatePath("/admin/catalogue");
  revalidatePath("/admin/stock");
  return { ok: true, message: "Purchase order status updated." };
}
