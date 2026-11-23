"use server";

import { getVerifiedBuyer } from "@/lib/auth/server";
import { serviceClient } from "@/lib/supabase/service";
import { requestAvailability, requestsUnavailable } from "./availability";
import { blockedSubmission, type EnquiryKind, type RequestFormState } from "./forms";
import { issuePhotoUploadToken, saveEnquiryPhotos } from "./photos";
import {
  caughtInHoneypot,
  compatibilitySchema,
  deliveryEnquirySchema,
  formErrors,
  readForm,
  tradeSchema,
  trialSchema,
} from "./validation";
import { allowRequest } from "./rate-limit";

const received: RequestFormState = { status: "success" };

async function submit(
  scope: "enquiry" | "trial" | "trade",
  email: string,
  save: () => PromiseLike<{ error: { message: string } | null; data: unknown }>,
): Promise<RequestFormState> {
  if (!requestAvailability().enabled) return { status: "error", message: requestsUnavailable };
  try {
    if (!await allowRequest(scope, email)) {
      return { status: "error", message: "Too many requests. Please try again later." };
    }
    const { error, data } = await save();
    if (!error && data) return received;
    if (scope === "trade" && error?.message === "trade_application_exists") {
      return { status: "error", message: "You already have an application. Reload this page to see its status." };
    }
    if (error?.message === "request_attempt_conflict") {
      return { status: "error", message: "This form was already used with different details. Reload the page and try again." };
    }
  } catch {
  }
  return { status: "error", message: "We couldn’t save your request. Please try again shortly." };
}

export async function submitEnquiry(
  kind: EnquiryKind, _previous: RequestFormState, form: FormData,
): Promise<RequestFormState> {
  if (caughtInHoneypot(form)) return blockedSubmission;
  if (kind === "delivery") {
    const input = readForm(deliveryEnquirySchema, form);
    if (!input.success) return formErrors(input.error);
    const { attemptId, email, postcode, message } = input.data;
    return submit("enquiry", email, () => serviceClient().rpc("submit_enquiry", {
      p_id: attemptId, p_kind: kind, p_email: email, p_postcode: postcode, p_message: message,
    }));
  }
  const input = readForm(compatibilitySchema, form);
  if (!input.success) return formErrors(input.error);
  const { attemptId, email, query, machineBrand, message } = input.data;
  const result = await submit("enquiry", email, () => serviceClient().rpc("submit_enquiry", {
    p_id: attemptId, p_kind: "compatibility", p_email: email, p_query: query || undefined,
    p_machine_brand: machineBrand || undefined, p_message: message,
  }));
  if (result.status !== "success") return result;
  const photoUploadToken = await issuePhotoUploadToken(attemptId, form.get("photoCount"));
  return photoUploadToken ? { ...result, photoUploadToken } : result;
}

export async function uploadEnquiryPhotos(token: string, form: FormData): Promise<number> {
  try {
    return await saveEnquiryPhotos(token, form.getAll("photo"));
  } catch {
    return 0;
  }
}

export async function submitTrialRequest(_previous: RequestFormState, form: FormData): Promise<RequestFormState> {
  if (caughtInHoneypot(form)) return blockedSubmission;
  const input = readForm(trialSchema, form);
  if (!input.success) return formErrors(input.error);
  const { attemptId, email, company, machineBrand, oemCode, postcode } = input.data;
  return submit("trial", email, () => serviceClient().rpc("submit_trial_request", {
    p_id: attemptId, p_machine_brand: machineBrand, p_oem_code: oemCode, p_email: email,
    p_company: company, p_postcode: postcode,
  }));
}

export async function submitTradeApplication(_previous: RequestFormState, form: FormData): Promise<RequestFormState> {
  if (caughtInHoneypot(form)) return blockedSubmission;
  const input = readForm(tradeSchema, form);
  if (!input.success) return formErrors(input.error);
  const buyer = await getVerifiedBuyer();
  if (!buyer) return { status: "error", message: "Sign in again before submitting your application." };
  const { attemptId, buyerName, company, billingLine1, billingLine2, billingTown, billingPostcode } = input.data;
  return submit("trade", buyer.email, () => serviceClient().rpc("submit_trade_application", {
    p_id: attemptId, p_buyer_id: buyer.id, p_buyer_name: buyerName, p_company: company,
    p_billing_line1: billingLine1, p_billing_line2: billingLine2 || undefined,
    p_billing_town: billingTown, p_billing_postcode: billingPostcode,
  }));
}
