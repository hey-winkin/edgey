import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { StaffRole } from "./auth";
import type { StaffTask } from "./navigation";
import { requestsDb } from "./request-schema";
import { countPublishedOutOfStock, countWarehousePicking } from "./warehouse";

const countOnly = { count: "exact", head: true } as const;
const awaitingReview = ["pending", "in_review"];

async function readCount(source: string, query: PromiseLike<{ count: number | null; error: unknown }>) {
  const result = await Promise.resolve(query).catch(() => null);
  if (result && !result.error && result.count !== null) return result.count;
  console.error(`Staff desk count unavailable: ${source}.`);
  return null;
}

export async function staffDeskCounts(db: SupabaseClient<Database>, roles: readonly StaffRole[]) {
  const warehouse = roles.includes("warehouse");
  const catalogue = roles.includes("catalogue");
  const canReviewTrade = roles.includes("finance");
  const trials = requestsDb(db).from("trial_requests").select("id", countOnly);
  const trialQuery = warehouse && catalogue ? trials.in("status", awaitingReview)
    : catalogue ? trials.eq("status", "pending")
    : warehouse ? trials.eq("status", "in_review").eq("eligibility", "eligible") : null;
  const signal = AbortSignal.timeout(5_000);
  const [orders, enquiries, trialCount, trialFollowUps, trade, outOfStock] = await Promise.all([
    warehouse ? readCount("orders", countWarehousePicking(db).abortSignal(signal)) : 0,
    warehouse || catalogue ? readCount("enquiries", db.from("enquiries").select("id", countOnly)
      .in("status", awaitingReview).abortSignal(signal)) : 0,
    trialQuery ? readCount("trials", trialQuery.abortSignal(signal)) : 0,
    warehouse || catalogue ? readCount("trial follow-ups", requestsDb(db)
      .rpc("admin_trial_follow_up_status", {}, countOnly).abortSignal(signal)) : 0,
    canReviewTrade ? readCount("trade applications", db.from("trade_applications").select("id", countOnly)
      .eq("status", "pending").abortSignal(signal)) : 0,
    warehouse ? readCount("out of stock", countPublishedOutOfStock(db).abortSignal(signal)) : 0,
  ]);

  return {
    orders,
    requests: enquiries === null || trialCount === null || trade === null ? null : enquiries + trialCount + trade,
    trialFollowUps,
    outOfStock,
  } satisfies Record<StaffTask, number | null>;
}
