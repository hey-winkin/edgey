"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin/auth";
import { parseCreditLimit } from "@/lib/admin/credit-limit";
import { approveTradeApplication, financeCreditRpc } from "@/lib/admin/trade";
import { TradeCustomerReviewError } from "@/lib/admin/trade-customer";
import { isWarehouseId } from "@/lib/admin/warehouse-format";
import type { AdminResult } from "../form";

const financeErrors = {
  finance_role_required: "You no longer have access to change trade terms.",
  trade_approval_stripe_account_mismatch: "Approval was started in another Stripe sandbox. Use the original sandbox to finish approving.",
  trade_application_not_reviewable: "This decision is no longer available. Reload to check the application.",
  trade_rejection_reason_required: "Enter an internal rejection reason of up to 500 characters.",
  verified_buyer_required: "This account needs a verified buyer before it can use Net 30.",
  trade_account_not_found: "This trade account could not be found.",
  trade_account_not_suspended: "Only a suspended account can be reinstated. Reload to check its status.",
  trade_account_already_exists: "This application already has a trade account.",
  operation_key_conflict: "This action was already used with different values. Reload before continuing.",
} satisfies Record<string, string>;

function failure(error: unknown, fallback: string): AdminResult {
  if (error instanceof TradeCustomerReviewError) return { ok: false, message: error.message };
  const code = error && typeof error === "object" && "message" in error ? error.message : null;
  return {
    ok: false,
    message: typeof code === "string" && Object.hasOwn(financeErrors, code)
      ? financeErrors[code as keyof typeof financeErrors]
      : fallback,
  };
}

function reasonFrom(form: FormData) {
  const value = form.get("reason");
  const reason = typeof value === "string" ? value.trim() : "";
  return reason && reason.length <= 500 ? reason : null;
}

export async function decideTradeApplication(
  applicationId: string, decision: "approved" | "rejected", _previous: AdminResult | null, form: FormData,
): Promise<AdminResult> {
  const { userId } = await requireStaff("finance");
  if (!isWarehouseId(applicationId) || !["approved", "rejected"].includes(decision)) {
    return { ok: false, message: "This is not a valid trade application decision." };
  }
  const applicationPath = `/admin/requests/trade/${applicationId}`;
  try {
    if (decision === "approved") {
      const creditLimit = parseCreditLimit(form.get("limit"));
      if (creditLimit === null) return { ok: false, message: "Enter a GBP amount from 0 to 21474836.47, with up to two decimal places." };
      await approveTradeApplication(applicationId, userId, creditLimit);
    } else {
      if (form.get("confirm") !== "yes") return { ok: false, message: "Confirm that you want to reject this application." };
      const reason = reasonFrom(form);
      if (!reason) return { ok: false, message: financeErrors.trade_rejection_reason_required };
      await financeCreditRpc("review_admin_trade_application", {
        p_application_id: applicationId, p_actor_id: userId, p_decision: decision, p_reason: reason,
      });
    }
  } catch (error) {
    revalidatePath(applicationPath);
    return failure(error, decision === "approved"
      ? "Could not confirm approval. Check the application before retrying; Stripe customer creation may already have started."
      : "Could not confirm rejection. Check the application before trying again.");
  }
  for (const path of [applicationPath, "/admin/requests", "/admin/finance", "/account"]) revalidatePath(path);
  return { ok: true, message: decision === "approved" ? "Trade account approved and notice queued." : "Application rejected and notice queued." };
}

export async function updateTradeCredit(
  accountId: string, operationKey: string, action: "limit" | "suspend" | "reinstate",
  _previous: AdminResult | null, form: FormData,
): Promise<AdminResult> {
  const { userId } = await requireStaff("finance");
  if (!isWarehouseId(accountId) || !isWarehouseId(operationKey) || !["limit", "suspend", "reinstate"].includes(action)) {
    return { ok: false, message: "This is not a valid trade credit action." };
  }
  const args = { p_trade_account_id: accountId, p_actor_id: userId, p_operation_key: operationKey };
  try {
    if (action === "limit") {
      const creditLimit = parseCreditLimit(form.get("limit"));
      if (creditLimit === null) return { ok: false, message: "Enter a GBP amount from 0 to 21474836.47, with up to two decimal places." };
      await financeCreditRpc("set_credit_limit", { ...args, p_credit_limit_pence: creditLimit });
    } else {
      if (action === "suspend" && form.get("confirm") !== "yes") {
        return { ok: false, message: "Confirm that you want to suspend Net 30 for this account." };
      }
      const reason = reasonFrom(form);
      if (!reason) return { ok: false, message: "Enter an internal reason of up to 500 characters." };
      await financeCreditRpc(action === "suspend" ? "suspend_trade_account" : "reinstate_trade_account", {
        ...args, p_reason: reason,
      });
    }
  } catch (error) {
    return failure(error, "Could not confirm this change. Check the current account state before trying again.");
  }
  for (const path of [`/admin/finance/accounts/${accountId}`, "/admin/finance", "/account"]) revalidatePath(path);
  return {
    ok: true,
    message: action === "limit" ? "Credit limit saved." : action === "suspend" ? "Net 30 suspended." : "Net 30 reinstated.",
  };
}
