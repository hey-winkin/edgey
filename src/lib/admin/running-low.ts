import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readSalesReport } from "@/lib/sales/database";
import { parseSalesQuery } from "@/lib/sales/report";
import { runningLowVariants } from "@/lib/sales/stock-cover";
import type { Database } from "@/lib/supabase/database.types";
import { getPurchaseStock } from "./purchase-order-data";

export const runningLowView = "running-low";
export const runningLowHref = `/admin/catalogue?view=${runningLowView}`;

export async function readRunningLow(db: SupabaseClient<Database>) {
  const { range } = parseSalesQuery({});
  if (!range) return null;
  const signal = AbortSignal.timeout(5_000);
  const { data, error } = await readSalesReport(db, range, "day").abortSignal(signal);
  if (error || !data) return null;
  const products = data.products.filter(({ stockFlag }) => stockFlag === "low");
  const ids = products.map(({ id }) => id);
  const batches = await Promise.all(Array.from({ length: Math.ceil(ids.length / 80) },
    (_, index) => getPurchaseStock(db, ids.slice(index * 80, (index + 1) * 80), signal)));
  const onOrder = new Map<string, number>();
  for (const batch of batches) {
    if (!batch) return null;
    for (const [id, { quantity }] of batch) {
      if (id && quantity !== null) onOrder.set(id, quantity);
    }
  }
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 + 1;
  return runningLowVariants(products, onOrder, days);
}
