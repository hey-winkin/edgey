"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/auth";
import {
  cancelOrder, dispatchOrder, receiveStock, restoreStock, startPicking,
} from "@/lib/orders";
import { commercialDb } from "@/lib/commercial/database";
import { isReportedLookupCode, isReturnCategory } from "@/lib/commercial/returns";
import { resolveStaffDelivery } from "./carrier-settings";
import { isStockAdjustmentReason, parseStaffCost, parseStockAdjustmentQuantity } from "./stock-cost";
import { canManageCosts, stockSchemaUnavailable } from "./stock-cost-data";
import { isWarehouseId } from "./warehouse-format";

type State = { message: string; ok: boolean } | null;
type WarehouseAction =
  | { kind: "pick" | "dispatch" | "cancel" | "return"; orderId: string; key: string }
  | { kind: "restore"; orderId: string; returnId: string; key: string }
  | { kind: "receive" | "adjust"; variantId: string; key: string };

const errors: Readonly<Record<string, string>> = {
  carrier_and_tracking_required: "Enter both the carrier and tracking number.",
  invalid_stock_receipt: "Enter a positive whole number of units.",
  stock_adjustment_below_reserved: "There are not enough available units for this reduction. It would put the balance below zero or take stock reserved for orders or trials.",
  invalid_stock_adjustment: "Check the adjustment and current balance. The resulting stock balance may be too large.",
  stock_variant_not_found: "This variant could not be found.",
  staff_cost_role_required: "Catalogue or finance permission is required to record costs.",
  order_return_reported_lookup_shape: "Enter only the blade part number or SKU for a wrong-fit return.",
  operation_key_conflict: "This form was already used with different values. Reload the page before starting a new operation.",
  order_cannot_be_cancelled: "This order can no longer be cancelled. Reload to check its current status.",
  order_not_dispatched: "Record a return only after the order has been dispatched.",
  order_not_found: "This order could not be found.",
  order_not_picking: "Start picking before dispatching. If you already did, reload to check the current status.",
  order_not_ready_to_pick: "This order is no longer ready to pick. Reload to check its current status.",
  order_payment_not_collectible: "A voided or fully refunded order cannot be picked or dispatched.",
  restore_exceeds_returned_quantity: "You can only restore units from this return that have not already been restored.",
  return_exceeds_dispatched_quantity: "The quantity is greater than the outstanding dispatched units on this line.",
  return_not_found: "This return could not be found.",
  warehouse_role_required: "You no longer have warehouse access.",
};

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function refused(message: string) {
  return { ok: false, message };
}

export async function runWarehouseAction(action: WarehouseAction, _previous: State, form: FormData) {
  const { userId: actorId, db, roles } = await requireStaff("warehouse");
  if (!action || !(form instanceof FormData) || !isWarehouseId(action.key) || (
    "variantId" in action ? !isWarehouseId(action.variantId) : !isWarehouseId(action.orderId)
  )) {
    return refused("This form is no longer valid. Reload the page and try again.");
  }

  const units = text(form, "quantity");
  const quantity = /^\d{1,10}$/.test(units) ? Number(units) : 0;
  if ((action.kind === "receive" || action.kind === "return" || action.kind === "restore") &&
    (quantity < 1 || quantity > 2_147_483_647)) {
    return refused("Enter a positive whole number of units.");
  }

  const operationKey = action.key;
  let message: string;
  let affectedVariant: string | undefined;

  try {
    switch (action.kind) {
      case "pick": {
        const updated = await startPicking({ orderId: action.orderId, actorId, operationKey });
        message = updated.fulfilment_status === "picking"
          ? "Picking started." : "The order has since moved on from picking.";
        break;
      }
      case "dispatch": {
        const trackingNumber = text(form, "trackingNumber");
        const delivery = await resolveStaffDelivery(db, form, true);
        if (!delivery.ok && delivery.reason === "unavailable") {
          return refused("Couldn’t check configured delivery services. Try again or select Other.");
        }
        if (!delivery.ok && delivery.reason === "stale") {
          return refused("That carrier service is no longer configured. Reload for the current choices, or select Other.");
        }
        if (!delivery.ok || !trackingNumber || trackingNumber.length > 200) {
          return refused("Enter a carrier (up to 100 characters) and tracking number (up to 200 characters).");
        }
        await dispatchOrder({ orderId: action.orderId, actorId, operationKey, carrier: delivery.carrier, trackingNumber });
        message = "Dispatch recorded.";
        break;
      }
      case "cancel":
        if (text(form, "confirmCancel") !== "yes") return refused("Confirm cancellation before continuing.");
        await cancelOrder({ orderId: action.orderId, actorId, operationKey });
        message = "Order cancelled and allocation released. Any refund is handled separately by finance.";
        break;
      case "return": {
        const variantId = text(form, "variantId");
        const reason = text(form, "reason");
        const category = text(form, "returnCategory");
        const reportedLookupCode = text(form, "reportedLookupCode");
        if (!isWarehouseId(variantId)) return refused("Select a dispatched line.");
        if (!isReturnCategory(category)) return refused("Choose a return category.");
        if (!reason || reason.length > 500) return refused("Enter a return reason of up to 500 characters.");
        if (reportedLookupCode && (category !== "wrong_fit" || !isReportedLookupCode(reportedLookupCode))) {
          return refused("Enter only the blade part number or SKU for a wrong-fit return. Do not enter personal details.");
        }
        const { error } = await commercialDb(db).rpc("record_structured_return", {
          p_order_id: action.orderId, p_return_id: operationKey, p_variant_id: variantId,
          p_quantity: quantity, p_reason: reason, p_reason_category: category,
          p_reported_lookup_code: reportedLookupCode || undefined,
        });
        if (error) throw error;
        message = "Return recorded. No units have been added to saleable stock.";
        break;
      }
      case "restore":
        if (!isWarehouseId(action.returnId)) return refused("This return could not be found.");
        affectedVariant = (await restoreStock({ returnId: action.returnId, actorId, operationKey, quantity })).variant_id;
        message = "Inspected units restored to saleable stock.";
        break;
      case "receive":
      {
        const parsed = parseStaffCost(form, true);
        if (!parsed.ok) return refused("For a costed receipt, choose the supplier currency and enter the supplier and landed unit amounts with up to two decimal places. Otherwise leave all cost fields blank.");
        if (parsed.value) {
          if (!canManageCosts(roles)) return refused(errors.staff_cost_role_required!);
          const { error } = await db.rpc("receive_staff_stock_with_cost", {
            p_variant_id: action.variantId, p_operation_key: operationKey, p_quantity: quantity, p_cost: parsed.value,
          });
          if (error) throw error;
          revalidatePath(`/admin/catalogue/${action.variantId}`);
        } else {
          await receiveStock({ variantId: action.variantId, actorId, operationKey, quantity });
        }
        affectedVariant = action.variantId;
        message = "Stock receipt recorded.";
        break;
      }
      case "adjust": {
        const adjustment = parseStockAdjustmentQuantity(units);
        const reason = text(form, "reason");
        const note = text(form, "adjustmentNote");
        if (adjustment === null) return refused("Enter a non-zero whole number, such as -2 or +3.");
        if (!isStockAdjustmentReason(reason)) return refused("Choose a reason for this adjustment.");
        if (adjustment > 0 && reason !== "count_correction" && reason !== "other") {
          return refused("Use Count correction or Other to add units, or Receive stock for a delivery.");
        }
        if (note.length > 500 || (reason === "other" && !note)) return refused("Enter a note of up to 500 characters. A note is required for Other.");
        const { error } = await db.rpc("adjust_staff_stock", {
          p_variant_id: action.variantId, p_operation_key: operationKey, p_quantity: adjustment,
          p_reason: reason, p_note: note || undefined,
        });
        if (error) throw error;
        affectedVariant = action.variantId;
        message = "Stock adjustment recorded.";
        break;
      }
      default:
        return refused("This warehouse operation is not available.");
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" &&
      stockSchemaUnavailable({ code: error.code })) {
      return refused("This action is not available until the database update is applied.");
    }
    if (typeof error === "object" && error !== null && "message" in error &&
      typeof error.message === "string" && Object.hasOwn(errors, error.message)) {
      return refused(errors[error.message] ?? "The warehouse operation was refused.");
    }
    return refused("The update could not be confirmed. Try again with the same values.");
  }

  if ("orderId" in action) {
    revalidatePath("/admin/warehouse");
    revalidatePath(`/admin/warehouse/${action.orderId}`);
  }
  if (affectedVariant || action.kind === "dispatch" || action.kind === "cancel") {
    revalidatePath("/admin/stock");
    revalidatePath(affectedVariant ? `/admin/stock/${affectedVariant}` : "/admin/stock/[id]", affectedVariant ? undefined : "page");
  }
  return { ok: true, message };
}
