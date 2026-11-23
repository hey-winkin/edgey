"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/admin/auth";
import { validDeliveryLabel } from "@/lib/admin/carrier";
import { parsePoundsToPence } from "@/lib/admin/pounds";
import { parseUkPostcode, STANDARD_DELIVERY_CHARGE_PENCE } from "@/lib/commerce";
import type { AdminResult } from "../form";

const path = "/admin/delivery";
const datesSchema = z.array(z.iso.date()).max(3660);

function field(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function saved(message: string): AdminResult {
  revalidatePath(path);
  return { ok: true, message };
}

export async function saveDeliveryRule(_: AdminResult | null, form: FormData): Promise<AdminResult> {
  const { db } = await requireStaff("warehouse");
  const scope = field(form, "scope");
  const code = field(form, "code").toUpperCase();
  if (scope !== "area" && scope !== "district") return { ok: false, message: "Choose an area or district." };
  const postcode = parseUkPostcode(scope === "area" && code !== "GIR" ? code + "1 1AA" :
    code === "GIR" ? "GIR 0AA" : code + " 1AA");
  if (!postcode.ok || postcode.value[scope] !== code) {
    return { ok: false, message: "Enter a UK postcode area (SW) or district (SW1A), not a full postcode." };
  }

  const kind = field(form, "kind");
  if (kind === "enquiry") {
    const { error } = await db.from("delivery_rules").upsert({
      scope, code, kind, dispatch_carrier: null, service_name: null, charge_ex_vat_pence: null, working_days: null,
    });
    return error ? { ok: false, message: "Couldn’t save the delivery rule." } : saved("Enquiry-only rule saved.");
  }
  if (kind !== "next-working-day" && kind !== "agreed") return { ok: false, message: "Choose a service type." };

  const serviceName = field(form, "service");
  const carrier = field(form, "carrier");
  const charge = kind === "agreed" ? parsePoundsToPence(form.get("chargeGbp")) : STANDARD_DELIVERY_CHARGE_PENCE;
  const days = field(form, "days");
  if (!validDeliveryLabel(serviceName)) {
    return { ok: false, message: "Enter a service name of up to 100 characters." };
  }
  if (carrier && !validDeliveryLabel(carrier)) return { ok: false, message: "Enter a carrier name of up to 100 characters, or leave it blank." };
  if (charge === null || (kind === "agreed" && (!/^\d{1,3}$/.test(days) || Number(days) < 2 || Number(days) > 366))) {
    return { ok: false, message: "For an agreed service, enter a price in pounds from £0.00 to £21,474,836.47 with up to two decimal places, and a transit time of 2 to 366 working days." };
  }
  const { error } = await db.from("delivery_rules").upsert({
    scope, code, kind, service_name: serviceName, dispatch_carrier: carrier || null,
    charge_ex_vat_pence: charge,
    working_days: kind === "agreed" ? Number(days) : 1,
  });
  return error ? { ok: false, message: "Couldn’t save the delivery rule." } : saved("Delivery rule saved.");
}

export async function removeDeliveryRule(
  scope: string, code: string, _: AdminResult | null, form: FormData,
): Promise<AdminResult> {
  const { db } = await requireStaff("warehouse");
  if (field(form, "confirm") !== "yes") return { ok: false, message: "Confirm this rule can be removed." };
  const { error, data } = await db.from("delivery_rules").delete().eq("scope", scope).eq("code", code).select("code").maybeSingle();
  return error || !data ? { ok: false, message: "Couldn’t remove the delivery rule." } : saved("Delivery rule removed.");
}

export async function saveDeliveryCalendar(
  calendar: "warehouse" | "carrier", _: AdminResult | null, form: FormData,
): Promise<AdminResult> {
  const { db } = await requireStaff("warehouse");
  const from = field(form, "from");
  const through = field(form, "through");
  const closureInput = field(form, "closures");
  if (closureInput.length > 44_000) {
    return { ok: false, message: "Too many closure dates." };
  }
  const closures = datesSchema.safeParse(closureInput ? [...new Set(closureInput.split(/[\s,]+/))].sort() : []);
  const weekdays = Array.from({ length: 7 }, (_, day) => day).filter((day) => form.getAll("weekday").includes(String(day)));
  const cutoff = field(form, "cutoff");
  if (!z.iso.date().safeParse(from).success || !z.iso.date().safeParse(through).success || from.startsWith("0000") ||
    Date.parse(through) < Date.parse(from) || Date.parse(through) - Date.parse(from) > 3660 * 86_400_000 ||
    !weekdays.length || (calendar === "warehouse" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff))) {
    return { ok: false, message: "Set a date range of up to ten years, at least one working day, and a London cut-off for the warehouse." };
  }
  if (!closures.success || closures.data.some((date) => date < from || date > through)) {
    return { ok: false, message: "Enter closure dates as YYYY-MM-DD within the active range." };
  }
  const { error } = await db.from("delivery_calendars").upsert({
    calendar, active_from: from, active_through: through, working_weekdays: weekdays,
    bank_holidays: [], closures: closures.data,
    cutoff_minutes: calendar === "warehouse" ? Number(cutoff.slice(0, 2)) * 60 + Number(cutoff.slice(3)) : null,
  });
  return error ? { ok: false, message: "Couldn’t save the calendar." } : saved("Delivery calendar saved.");
}
