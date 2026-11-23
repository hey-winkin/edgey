"use server";

import { revalidatePath } from "next/cache";
import type { AdminResult } from "@/app/admin/form";
import { staffSession } from "@/lib/admin/auth";
import { MAX_DELIVERY_ROWS, parseDeliveryCost } from "@/lib/admin/deliveries";
import { canManageCosts } from "@/lib/admin/stock-cost-data";
import { isWarehouseId } from "@/lib/admin/warehouse-format";

export async function addDeliveryLineCost(id: string, position: number, _previous: AdminResult | null, form: FormData): Promise<AdminResult> {
  const staff = await staffSession();
  if (!staff || !canManageCosts(staff.roles)) return { ok: false, message: "Cost access is required." };
  if (!isWarehouseId(id) || !Number.isInteger(position) || position < 1 || position > MAX_DELIVERY_ROWS) {
    return { ok: false, message: "Delivery line not found." };
  }
  const amount = form.get("unitCost");
  const pence = typeof amount === "string" && amount.length <= 120 ? parseDeliveryCost(amount) : null;
  if (pence === null) return { ok: false, message: "Enter a cost in pounds with up to two decimal places." };
  const { error } = await staff.db.rpc("add_staff_delivery_line_cost", {
    p_delivery_id: id, p_position: position, p_unit_cost_pence: pence,
  });
  if (error) {
    if (error.code === "22023") return { ok: false, message: "This line cannot be costed here. Reload the delivery to check whether a cost is already recorded." };
    return { ok: false, message: "Could not confirm that the cost was saved. Try again or reload the delivery." };
  }
  revalidatePath(`/admin/stock/deliveries/${id}`);
  return { ok: true, message: "Unit cost saved." };
}
