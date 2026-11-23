import "server-only";

import { getOrder, getOrderItems, paymentStore } from "@/lib/payments/store";
import { getStripe } from "@/lib/payments/stripe";
import type { Database } from "@/lib/supabase/database.types";
import { hostedStripeInvoice, renderConfirmation } from "./confirmation";
import { dispatchLines, renderDispatch } from "./dispatch";
import { getEmailProvider, type SendResult } from "./provider";
import {
  hasStaffDestination, requestEmailSource, requestFollowUp, requestReceipt, requestStaffEmail, requestStaffNotice,
} from "./request-email";

type Claim = Database["public"]["Tables"]["order_outbox"]["Row"];
type EmailQueue = "order_confirmation" | "order_dispatched" | "confirmation" | "staff_notification" | "request_follow_up";
type Outcome = SendResult["status"] | "defer_invoice" | "preparation_failed" | "configuration_error";

type DeliveryStatus = "sent" | "failed" | "pending";
const invoiceGraceMs = 2 * 60_000;

async function invoiceLink(invoiceId: string | null) {
  if (!invoiceId) return null;
  try {
    const invoice = await getStripe().invoices.retrieve(invoiceId, {}, { maxNetworkRetries: 0, timeout: 3_000 });
    return hostedStripeInvoice(invoice.hosted_invoice_url);
  } catch {
    return null;
  }
}

async function deliver(claim: Claim): Promise<DeliveryStatus> {
  if (!claim.lease_token) return "failed";
  const db = paymentStore();
  const lease = { p_outbox_id: claim.id, p_lease_token: claim.lease_token };
  async function finish(outcome: Outcome, providerMessageId?: string) {
    const { data, error } = await db.rpc("finish_outbox_email", {
      ...lease, p_outcome: outcome, p_provider_message_id: providerMessageId,
    });
    if (error) throw error;
    return data?.[0]?.state ?? "pending";
  }

  const provider = getEmailProvider();
  if (!provider || (claim.send_provider && claim.send_provider !== provider.name)) {
    return finish("configuration_error");
  }

  const staff = claim.message_key === "staff_notification" ? requestStaffEmail() : null;
  if (claim.message_key === "staff_notification"
    && (!staff || (claim.send_payload && !hasStaffDestination(claim.send_payload, staff)))) {
    return finish("configuration_error");
  }

  let payload: string | undefined;
  let recipientFingerprint: string | undefined;
  if (claim.send_payload === null) {
    const from = process.env.EMAIL_FROM?.trim();
    if (!from || /[\r\n]/.test(from)) return finish("configuration_error");

    async function trackingPattern(carrier: string) {
      const { data, error } = await db.from("delivery_tracking_patterns")
        .select("url_pattern").eq("carrier", carrier).maybeSingle();
      if (error) throw error;
      return data?.url_pattern;
    }

    if (claim.order_id) {
      const order = await getOrder(claim.order_id);
      if (!order) return finish("preparation_failed");
      if (claim.message_key === "order_dispatched") {
        if (!order.dispatched_at || !order.carrier || !order.tracking_number) return finish("preparation_failed");
        const [items, pattern] = await Promise.all([getOrderItems(order.id), trackingPattern(order.carrier)]);
        try {
          payload = JSON.stringify(renderDispatch({
            ...order, service: order.delivery_service, carrier: order.carrier,
            tracking: order.tracking_number, reference: order.order_reference, kind: "order",
          }, items, from, pattern));
        } catch {
          return finish("preparation_failed");
        }
      } else {
        const invoice = order.payment_method === "card" ? await invoiceLink(order.provider_invoice_id) : null;
        if (order.payment_method === "card" && !invoice && Date.now() - Date.parse(claim.created_at) < invoiceGraceMs) {
          return finish("defer_invoice");
        }
        const items = await getOrderItems(order.id);
        try {
          payload = JSON.stringify(renderConfirmation(order, items, from, invoice));
        } catch {
          return finish("preparation_failed");
        }
      }
    } else {
      const source = requestEmailSource(claim);
      if (!source) return finish("preparation_failed");
      if (staff) {
        payload = requestStaffNotice(from, staff, source);
      } else {
        const { data, error } = await db.from(source.table).select("email").eq("id", source.id).maybeSingle();
        if (error) throw error;
        if (!data) return finish("preparation_failed");
        if (claim.message_key === "confirmation") {
          const receipt = requestReceipt(from, data.email);
          if (!receipt) return finish("preparation_failed");
          ({ payload, recipientFingerprint } = receipt);
        } else if (claim.message_key === "trial_dispatched" && claim.dispatch_lines != null) {
          const lines = dispatchLines.safeParse(claim.dispatch_lines);
          if (!lines.success) return finish("preparation_failed");
          const { data: trial, error: trialError } = await db.from("trial_fulfilments")
            .select("recipient_name,address_line1,address_line2,address_town,address_region,address_postcode,address_country,carrier,carrier_service,tracking_number")
            .eq("trial_request_id", source.id).eq("state", "dispatched").maybeSingle();
          if (trialError) throw trialError;
          if (!trial?.tracking_number) return finish("preparation_failed");
          const pattern = await trackingPattern(trial.carrier);
          try {
            payload = JSON.stringify(renderDispatch({
              ...trial, email: data.email, service: trial.carrier_service, tracking: trial.tracking_number,
              reference: source.id, kind: "trial",
            }, lines.data, from, pattern));
          } catch {
            return finish("preparation_failed");
          }
        } else {
          const followUp = requestFollowUp(from, data.email, claim.message_subject, claim.message_body);
          if (!followUp) return finish("preparation_failed");
          payload = followUp;
        }
      }
    }
  }

  const beforeBegin = performance.now();
  const { data, error } = await db.rpc("begin_outbox_email_send", {
    ...lease, p_recipient_fingerprint: recipientFingerprint,
    ...(payload === undefined ? {} : { p_payload: payload, p_provider: provider.name }),
  });
  if (error) throw error;
  const attempt = data?.[0];
  if (!attempt?.send_in_flight || !attempt.send_payload) return attempt?.state ?? "pending";
  if (performance.now() - beforeBegin > 15_000) return finish("provider_uncertain");

  const result = await provider.send(`outbox-email/${claim.id}`, attempt.send_payload);
  return result.status === "sent" ? finish("sent", result.id) : finish(result.status);
}

async function claimEmail(queue: EmailQueue, orderId?: string, expectedVersion?: string) {
  const { data, error } = await paymentStore().rpc("claim_outbox_email", {
    p_message_key: queue, p_replay_order_id: orderId, p_expected_updated_at: expectedVersion,
  });
  if (queue === "order_dispatched" && error?.code === "22023" && error.message === "invalid_outbox_email_queue") {
    return undefined;
  }
  if (error) throw error;
  return data?.[0];
}

async function processEmails(queues: EmailQueue[]) {
  const started = performance.now();
  const result = { sent: 0, failed: 0, pending: 0 };
  for (let i = 0; i < 10 && queues.length && performance.now() - started < 40_000; i++) {
    const queue = queues.shift()!;
    const claim = await claimEmail(queue);
    if (!claim) continue;
    queues.push(queue);
    result[await deliver(claim)]++;
  }
  return result;
}

export function processOrderConfirmations() {
  return processEmails(["order_confirmation", "order_dispatched"]);
}

export function processRequestEmails() {
  return processEmails(["confirmation", "staff_notification", "request_follow_up"]);
}

export async function replayOrderConfirmation(orderId: string, expectedVersion?: string): Promise<DeliveryStatus | "not_replayable"> {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(orderId)) return "not_replayable";
  const claim = await claimEmail("order_confirmation", orderId, expectedVersion);
  return claim?.lease_token ? deliver(claim) : "not_replayable";
}
