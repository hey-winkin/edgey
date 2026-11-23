"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/auth";
import { resolveStaffDelivery } from "@/lib/admin/carrier-settings";
import { requestsDb, type EnquiryMutation } from "@/lib/admin/request-schema";
import { requireRequestsStaff } from "@/lib/admin/requests";
import { isWarehouseId, warehouseOrderLookup } from "@/lib/admin/warehouse-format";
import { deliveryCoverageForPostcode } from "@/lib/delivery/server";
import type { AdminResult } from "../form";

type TrialAction =
  | { kind: "eligible" | "declined"; id: string; version: string }
  | { kind: "approve"; id: string; variantIds: string[] }
  | { kind: "unlink"; id: string; orderId: string }
  | { kind: "dispatch" | "cancel" | "link"; id: string };

type EnquiryAction = {
  kind: "reply" | "match" | "close";
  id: string;
  version: string;
  key?: string;
};

const messages = {
  catalogue_role_required: "Only catalogue staff can record this decision.",
  requests_role_required: "You no longer have access to handle requests.",
  warehouse_role_required: "Only warehouse staff can approve, dispatch, cancel or link a trial.",
  enquiry_not_found: "This enquiry could not be found.",
  enquiry_closed: "This enquiry is closed.",
  enquiry_stale: "Someone updated this enquiry. Reload to check the latest state.",
  enquiry_operation_conflict: "This reply form already queued different text. Reload before writing a new reply.",
  enquiry_cannot_match: "Only an open or replied compatibility enquiry can be matched.",
  enquiry_reply_required: "Enter a reply of up to 2,000 characters.",
  invalid_candidate_code: "Enter a part code of up to 80 characters, or leave it blank.",
  trial_stale: "Someone updated this trial. Reload to check the latest review.",
  trial_not_found: "This trial request could not be found.",
  trial_not_approvable: "This trial cannot be approved. Check its current eligibility and status.",
  trial_already_approved: "This trial was already approved with different details.",
  trial_was_cancelled: "This trial was cancelled and its allocation was released.",
  trial_not_reviewable: "This trial can no longer be reviewed. Reload to check its current status.",
  invalid_trial_review: "Enter a decision reason of up to 2,000 characters.",
  eligible_trial_review_required: "Catalogue staff must record an eligible decision and confirm both blade units first.",
  trial_units_do_not_match_review: "The reviewed blade units have changed. Reload before approving.",
  invalid_trial_address: "Enter a recipient, street address and town, with no blank fields.",
  trial_not_allocated: "Only an approved trial with two allocated units can be dispatched or cancelled.",
  two_trial_units_required: "A trial needs exactly two blade units.",
  verified_delivery_address_and_service_required: "Enter a complete UK delivery address and the carrier and service that can deliver to it.",
  trial_tracking_required: "Enter the tracking number.",
  trial_tracking_already_recorded: "This trial was already dispatched with a different tracking number.",
  variant_not_published: "The selected blade is no longer published. Choose a published variant.",
  insufficient_stock: "There aren’t enough available units. Ask catalogue staff to review the blade choices.",
  trial_order_link_not_available: "Only a dispatched trial without a linked order can be linked.",
  not_a_subsequent_purchase: "Select an authorised, non-cancelled purchase placed after the trial was dispatched.",
  trial_order_already_linked: "This order is already linked to a trial.",
  trial_order_link_changed: "The linked order has changed. Reload before removing the link.",
} satisfies Record<string, string>;

function field(form: FormData, name: string) {
  const entry = form.get(name);
  return typeof entry === "string" ? entry.trim() : "";
}

function refused(message: string, field?: string): AdminResult {
  return { ok: false, message, ...(field ? { field } : {}) };
}

function updateError(error: { message: string; code: string }, fallback: string, trial = false) {
  if (Object.hasOwn(messages, error.message)) return refused(messages[error.message as keyof typeof messages]);
  if (error.code === "P0002") return refused("The request, fulfilment or order could not be found.");
  if (trial && (error.code === "23514" || error.code === "23502")) {
    return refused("A trial must have two allocated units and a complete, verified UK delivery address.");
  }
  return refused(fallback);
}

export async function handleTrial(action: TrialAction, _previous: AdminResult | null, form: FormData): Promise<AdminResult> {
  const reviewing = action.kind === "eligible" || action.kind === "declined";
  const { userId, db: staffDb } = await requireStaff(reviewing ? "catalogue" : "warehouse");
  if (!isWarehouseId(action.id)) return refused("This trial request could not be found.");
  const db = requestsDb();
  const args = { p_trial_request_id: action.id, p_actor_id: userId };
  let result;
  let message;
  let orderId: string | undefined;

  switch (action.kind) {
    case "eligible":
    case "declined": {
      if (action.kind === "declined" && field(form, "confirm") !== "yes") return refused("Confirm that you want to decline this trial.");
      const reason = field(form, "reason");
      if (!reason || reason.length > 2000) return refused("Enter a decision reason of up to 2,000 characters.");
      const ids = action.kind === "eligible" ? [field(form, "unit1"), field(form, "unit2")] : [];
      if (!ids.every(isWarehouseId)) return refused("Choose both blade units.");
      result = await db.rpc("review_admin_trial", {
        ...args, p_decision: action.kind, p_reason: reason, p_variant_ids: ids, p_expected_updated_at: action.version,
      });
      message = action.kind === "eligible"
        ? "Eligible decision recorded. Warehouse can now check the address and reserve the units."
        : "Trial declined. The decision notice is queued.";
      break;
    }
    case "approve": {
      const recipient = field(form, "recipient");
      const line1 = field(form, "line1");
      const line2 = field(form, "line2");
      const town = field(form, "town");
      const region = field(form, "region");
      const coverage = await deliveryCoverageForPostcode(field(form, "postcode"));
      if (!coverage.ok) return refused(coverage.error.code === "invalid_postcode"
        ? "Enter a full UK delivery postcode." : "Delivery coverage couldn’t be checked. Try again before approving.", "postcode");
      if (coverage.value.kind !== "covered") return refused("The delivery postcode is outside configured coverage. Do not approve until an agreed service is configured for it.", "postcode");
      if (!recipient || recipient.length > 200 || !line1 || line1.length > 200 || line2.length > 200 ||
        !town || town.length > 100 || region.length > 100 || field(form, "verified") !== "yes") {
        return refused(messages.verified_delivery_address_and_service_required);
      }
      if (action.variantIds.length !== 2 || !action.variantIds.every(isWarehouseId)) return refused(messages.two_trial_units_required);
      const delivery = await resolveStaffDelivery(staffDb, form, false);
      if (!delivery.ok && delivery.reason === "unavailable") {
        return refused("Couldn’t check configured delivery services. Try again or select Other.");
      }
      if (!delivery.ok) return refused(delivery.reason === "stale"
        ? "That delivery service is no longer configured. Reload for the current choices, or select Other."
        : messages.verified_delivery_address_and_service_required);
      result = await db.rpc("approve_trial_fulfilment", {
        ...args, p_variant_ids: action.variantIds,
        p_address: {
          recipient_name: recipient, line1, line2: line2 || null, town, region: region || null,
          postcode: coverage.value.postcode.normalised, country: "GB",
        },
        p_carrier: delivery.carrier, p_carrier_service: delivery.service, p_address_verified: true,
      });
      message = "Trial approved. Two units are reserved and the approval notice is queued.";
      break;
    }
    case "dispatch": {
      const tracking = field(form, "tracking");
      if (!tracking || tracking.length > 200) return refused(messages.trial_tracking_required);
      result = await db.rpc("dispatch_trial_fulfilment", { ...args, p_tracking_number: tracking });
      message = "Dispatch recorded and the tracking notice is queued.";
      break;
    }
    case "cancel":
      if (field(form, "confirm") !== "yes") return refused("Confirm cancellation before continuing.");
      result = await db.rpc("cancel_trial_fulfilment", args);
      message = "Trial cancelled and the two units released.";
      break;
    case "link": {
      const lookup = warehouseOrderLookup(field(form, "orderId"));
      if (!lookup) return refused("Enter a full order reference.");
      if (field(form, "confirm") !== "yes") return refused("Confirm this order followed the trial.");
      const { data: order, error } = await staffDb.from("orders").select("id")
        .eq(lookup.field, lookup.value).not("authorised_at", "is", null).maybeSingle();
      if (error) return refused("Could not check the order reference. Try again.");
      if (!order) return refused("No eligible order was found for that reference.");
      orderId = order.id;
      result = await db.rpc("link_trial_order", { ...args, p_order_id: orderId });
      message = "Order linked to the trial.";
      break;
    }
    case "unlink":
      orderId = action.orderId;
      if (!isWarehouseId(orderId) || field(form, "confirm") !== "yes") return refused("Confirm removal of the order link first.");
      result = await db.rpc("unlink_trial_order", { ...args, p_order_id: orderId });
      message = "Order link removed.";
      break;
    default:
      return refused("This trial operation is not available.");
  }

  if (result.error) return updateError(result.error, "Could not confirm the trial update. Try again with the same values.", true);
  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/trials/${action.id}`);
  if (action.kind === "approve" || action.kind === "cancel" || action.kind === "dispatch") {
    for (const path of ["/", "/blades", "/admin/stock"]) revalidatePath(path);
    revalidatePath("/blades/[slug]", "page");
    revalidatePath("/admin/stock/[id]", "page");
  }
  if (orderId) {
    revalidatePath(`/admin/warehouse/${orderId}`);
    revalidatePath("/admin");
  }
  return { ok: true, message };
}

export async function handleEnquiry(action: EnquiryAction, _previous: AdminResult | null, form: FormData): Promise<AdminResult> {
  const { userId } = await requireRequestsStaff();
  if (!isWarehouseId(action.id)) return refused(messages.enquiry_not_found);
  const args: EnquiryMutation = {
    p_enquiry_id: action.id, p_actor_id: userId, p_action: action.kind, p_expected_updated_at: action.version,
  };
  let message: string;
  switch (action.kind) {
    case "reply": {
      const reply = field(form, "reply");
      if (!isWarehouseId(action.key) || !reply || reply.length > 2000) return refused(messages.enquiry_reply_required);
      args.p_operation_key = action.key;
      args.p_reply = reply;
      message = "Reply queued for sending.";
      break;
    }
    case "match": {
      const variantId = field(form, "variantId");
      const candidate = field(form, "candidate");
      if (!isWarehouseId(variantId)) return refused("Choose a published variant.");
      if (candidate && !/^[A-Za-z0-9][A-Za-z0-9 ./_+-]{0,79}$/.test(candidate)) return refused(messages.invalid_candidate_code);
      args.p_variant_id = variantId;
      if (candidate) args.p_candidate_code = candidate;
      message = "Match recorded. No public alias was added.";
      break;
    }
    case "close":
      if (field(form, "confirm") !== "yes") return refused("Confirm that you want to close this enquiry.");
      message = "Enquiry closed.";
      break;
    default:
      return refused("This enquiry operation is not available.");
  }
  const result = await requestsDb().rpc("handle_admin_enquiry", args);
  if (result.error) return updateError(result.error, "Could not confirm the enquiry update. Try again with the same values.");
  revalidatePath("/admin/requests");
  revalidatePath(`/admin/requests/enquiries/${action.id}`);
  return { ok: true, message };
}
