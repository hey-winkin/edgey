import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { deliveryChoiceValue, OTHER_DELIVERY, resolveDeliveryChoice, validDeliveryLabel, type StaffDeliveryChoice } from "./carrier";

export async function readStaffDeliveryChoices(db: SupabaseClient<Database>) {
  const choices = new Map<string, StaffDeliveryChoice>();
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await db.from("delivery_rules")
      .select("service_name,dispatch_carrier").neq("kind", "enquiry").order("scope").order("code")
      .range(start, start + pageSize - 1);
    if (error) throw new Error("Couldn’t load configured delivery services.");
    for (const row of data) {
      if (!row.service_name || !validDeliveryLabel(row.service_name)) continue;
      const carrier = row.dispatch_carrier;
      const choice = { service: row.service_name, carrier: carrier && validDeliveryLabel(carrier) ? carrier : null };
      choices.set(deliveryChoiceValue(choice), choice);
    }
    if (data.length < pageSize) break;
  }
  return [...choices.values()].sort((a, b) => a.service.localeCompare(b.service) ||
    (a.carrier ?? "").localeCompare(b.carrier ?? ""));
}

export async function resolveStaffDelivery(db: SupabaseClient<Database>, form: FormData, dispatch: boolean) {
  const choices = form.get("deliveryChoice") === OTHER_DELIVERY ? [] : await readStaffDeliveryChoices(db).catch(() => null);
  return choices ? resolveDeliveryChoice(form, choices, dispatch) : { ok: false, reason: "unavailable" } as const;
}
