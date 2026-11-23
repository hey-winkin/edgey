import "server-only";

import { parseUkPostcode, type CommerceResult, type CoverageError, type DeliveryCoverage } from "@/lib/commerce";
import { serviceClient } from "@/lib/supabase/service";
import { readBankHolidayDates } from "./bank-holidays";
import { parseDeliveryTerms, warehouseScheduleSchema, type DeliveryResolution, type WarehouseSchedule } from "./terms";

export async function readWarehouseSchedule(): Promise<WarehouseSchedule | null> {
  try {
    const { data, error } = await serviceClient().rpc("checkout_warehouse_calendar", {
      p_official_bank_holidays: await readBankHolidayDates(),
    });
    return error ? null : warehouseScheduleSchema.safeParse(data).data ?? null;
  } catch {
    return null;
  }
}

export async function resolveCheckoutDelivery(input: string): Promise<DeliveryResolution> {
  const postcode = parseUkPostcode(input);
  if (!postcode.ok) return postcode;

  try {
    const { data, error } = await serviceClient().rpc("checkout_delivery_terms", {
      p_postcode: postcode.value.normalised,
      p_official_bank_holidays: await readBankHolidayDates(),
    });
    if (!error && data === null) return { ok: true, value: { postcode: postcode.value, terms: null } };
    if (!error) {
      const terms = parseDeliveryTerms(data);
      if (terms) return { ok: true, value: { postcode: postcode.value, terms } };
    }
  } catch {
    return { ok: false, error: { code: "invalid_delivery_quote" } };
  }
  return { ok: false, error: { code: "invalid_delivery_quote" } };
}

export async function deliveryCoverageForPostcode(input: string): Promise<CommerceResult<DeliveryCoverage, CoverageError>> {
  const resolved = await resolveCheckoutDelivery(input);
  if (!resolved.ok) return resolved;
  const { postcode, terms } = resolved.value;
  return { ok: true, value: terms
    ? { kind: "covered", postcode, quote: terms.quote }
    : { kind: "enquiry-required", postcode } };
}
