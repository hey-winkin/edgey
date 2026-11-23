import "server-only";

import { requireStaff } from "@/lib/admin/auth";
import { getVerifiedBuyer } from "@/lib/auth/server";
import { readBankHolidayDates } from "@/lib/delivery/bank-holidays";
import type { CreateOrderInput } from "@/lib/orders";
import { orderReservationArgs, type ReservationRateKeys } from "@/lib/orders/reservation-input";
import { serviceClient } from "@/lib/supabase/service";
import type { Database } from "@/lib/supabase/database.types";

export type Net30OrderInput = Omit<CreateOrderInput, "buyerId"> & { poNumber: string };

export type BindInvoiceInput = {
  orderId: string;
  providerInvoiceId: string;
  stripeCustomerId: string;
  amountDuePence: number;
  currency: string;
  issuedAt: string;
  dueAt: string;
  promise: CreateOrderInput["promise"];
};

export type ReleaseCreditHoldInput = { orderId: string; operationKey: string } & (
  | { resolution: "not_created"; providerInvoiceId?: never }
  | { resolution: "deleted" | "voided"; providerInvoiceId: string }
);

export type InvoiceAmountOperation = {
  providerInvoiceId: string;
  operationKey: string;
  amountPence: number;
  currency: string;
};

type Functions = Database["public"]["Functions"];

async function call<Name extends keyof Functions>(name: Name, args: Functions[Name]["Args"]) {
  const { data, error } = await serviceClient().rpc(name, args);
  if (error) throw error;
  if (data === null) throw new Error(`Supabase did not return a result for ${name}.`);
  return data;
}

async function verifiedActorId() {
  const actor = await getVerifiedBuyer();
  if (!actor) throw new Error("A verified session is required.");
  return actor.id;
}

export async function approveTradeAccount(input: {
  applicationId: string;
  creditLimitPence: number;
  stripeCustomerId: string;
}) {
  return call("approve_trade_account", {
    p_application_id: input.applicationId,
    p_actor_id: (await requireStaff("finance")).userId,
    p_credit_limit_pence: input.creditLimitPence,
    p_stripe_customer_id: input.stripeCustomerId,
  });
}

export async function setCreditLimit(input: {
  tradeAccountId: string;
  operationKey: string;
  creditLimitPence: number;
}) {
  return call("set_credit_limit", {
    p_trade_account_id: input.tradeAccountId,
    p_actor_id: (await requireStaff("finance")).userId,
    p_operation_key: input.operationKey,
    p_credit_limit_pence: input.creditLimitPence,
  });
}

export async function suspendTradeAccount(input: {
  tradeAccountId: string;
  operationKey: string;
  reason: string;
}) {
  return call("suspend_trade_account", {
    p_trade_account_id: input.tradeAccountId,
    p_actor_id: (await requireStaff("finance")).userId,
    p_operation_key: input.operationKey,
    p_reason: input.reason,
  });
}

export async function createNet30OrderWithHolds(input: Net30OrderInput, rateKeys?: ReservationRateKeys) {
  return call("reserve_order_with_delivery", {
    ...orderReservationArgs(input, rateKeys),
    p_buyer_id: await verifiedActorId(),
    p_po_number: input.poNumber,
    p_delivery_terms: input.deliveryTerms,
    p_payment_method: "net30",
    p_official_bank_holidays: await readBankHolidayDates(),
  });
}

export function bindInvoice(input: BindInvoiceInput) {
  return call("bind_invoice", {
    p_order_id: input.orderId,
    p_provider_invoice_id: input.providerInvoiceId,
    p_stripe_customer_id: input.stripeCustomerId,
    p_amount_due_pence: input.amountDuePence,
    p_currency: input.currency,
    p_issued_at: input.issuedAt,
    p_due_at: input.dueAt,
    p_dispatch_date: input.promise.dispatchDate,
    p_delivery_date: input.promise.deliveryDate,
  });
}

export function releaseCreditHold(input: ReleaseCreditHoldInput) {
  return call("release_credit_hold", {
    p_order_id: input.orderId,
    p_operation_key: input.operationKey,
    p_resolution: input.resolution,
    p_provider_invoice_id: input.providerInvoiceId,
  });
}

function invoiceAmountArgs(input: InvoiceAmountOperation) {
  return {
    p_provider_invoice_id: input.providerInvoiceId,
    p_operation_key: input.operationKey,
    p_amount_pence: input.amountPence,
    p_currency: input.currency,
  };
}

export function applyInvoicePayment(input: InvoiceAmountOperation) {
  return call("apply_invoice_payment", invoiceAmountArgs(input));
}

export function applyCreditNote(input: InvoiceAmountOperation & { prePaymentPence: number }) {
  return call("apply_credit_note", {
    ...invoiceAmountArgs(input),
    p_pre_payment_pence: input.prePaymentPence,
  });
}

export function voidInvoice(providerInvoiceId: string) {
  return call("void_invoice", { p_provider_invoice_id: providerInvoiceId });
}

export function applyInvoiceRefund(input: InvoiceAmountOperation) {
  return call("apply_invoice_refund", invoiceAmountArgs(input));
}
