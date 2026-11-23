import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { StaffRole } from "./auth";
import type { StaffTask } from "./navigation";
import { requestsDb } from "./request-schema";
import { countWarehousePicking } from "./warehouse";

const countOnly = { count: "exact", head: true } as const;
const awaitingReview = ["pending", "in_review"];

async function readCount(query: PromiseLike<{ count: number | null; error: unknown }>) {
  try {
    const { count, error } = await query;
    return error ? null : count;
  } catch {
    return null;
  }
}

export async function staffDeskCounts(db: SupabaseClient<Database>, roles: readonly StaffRole[]) {
  const warehouse = roles.includes("warehouse");
  const catalogue = roles.includes("catalogue");
  const canReviewTrade = roles.includes("finance");
  const trials = requestsDb(db).from("trial_requests").select("id", countOnly);
  const trialQuery = warehouse && catalogue ? trials.in("status", awaitingReview)
    : catalogue ? trials.eq("status", "pending")
    : warehouse ? trials.eq("status", "in_review").eq("eligibility", "eligible") : null;
  const [orders, enquiries, trialCount, trade, outOfStock] = await Promise.all([
    warehouse ? readCount(countWarehousePicking(db)) : 0,
    warehouse || catalogue ? readCount(db.from("enquiries").select("id", countOnly).in("status", awaitingReview)) : 0,
    trialQuery ? readCount(trialQuery) : 0,
    canReviewTrade ? readCount(db.from("trade_applications").select("id", countOnly).eq("status", "pending")) : 0,
    warehouse ? readCount(db.from("variants").select("id", countOnly)
      .eq("publication_status", "published").eq("availability", "out_of_stock")) : 0,
  ]);

  return {
    orders,
    requests: enquiries === null || trialCount === null || trade === null ? null : enquiries + trialCount + trade,
    outOfStock,
  } satisfies Record<StaffTask, number | null>;
}
