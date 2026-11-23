import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { staffDeskCounts } from "@/lib/admin/desk";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

const counts = { orders: 41, enquiries: 2, trial_requests: 3, admin_trial_follow_up_status: 7, trade_applications: 5, variants: 4 };

function counter(values: Partial<Record<keyof typeof counts, number | "error">> = counts) {
  const queries = new Map<string, Record<string, string>>();
  const db = createClient<Database>("http://127.0.0.1:54321", "test-api-key", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      async fetch(input, init) {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1) as keyof typeof counts;
        expect(init?.method).toBe("HEAD");
        expect(new Headers(init?.headers).get("prefer")).toContain("count=exact");
        queries.set(table, Object.fromEntries(url.searchParams));
        const count = values[table];
        return count === "error" ? new Response(null, { status: 500 })
          : new Response(null, { headers: { "content-range": `*/${count ?? 0}` } });
      },
    },
  });
  return { db, queries };
}

test("all-role totals use exact counts for the picking queue, outstanding requests and published stock", async () => {
  const { db, queries } = counter();
  expect(await staffDeskCounts(db, ["warehouse", "catalogue", "finance"]))
    .toEqual({ orders: 41, requests: 10, trialFollowUps: 7, outOfStock: 4 });
  expect(queries.get("orders")).toEqual({
    select: "id", authorised_at: "not.is.null", fulfilment_status: "in.(ready_to_pick,picking)",
    payment_status: "not.in.(refunded,voided)",
  });
  expect(queries.get("enquiries")).toEqual({ select: "id", status: "in.(pending,in_review)" });
  expect(queries.get("trial_requests")).toEqual({ select: "id", status: "in.(pending,in_review)" });
  expect(queries.get("trade_applications")).toEqual({ select: "id", status: "eq.pending" });
  expect(queries.get("variants")).toEqual({ select: "id", publication_status: "eq.published", availability: "eq.out_of_stock" });
});

test("roles only count their actionable sources and trial stages", async () => {
  const warehouse = counter();
  expect(await staffDeskCounts(warehouse.db, ["warehouse"])).toEqual({ orders: 41, requests: 5, trialFollowUps: 7, outOfStock: 4 });
  expect([...warehouse.queries.keys()].sort()).toEqual(["admin_trial_follow_up_status", "enquiries", "orders", "trial_requests", "variants"]);
  expect(warehouse.queries.get("trial_requests")).toEqual({ select: "id", status: "eq.in_review", eligibility: "eq.eligible" });
  const catalogue = counter();
  expect(await staffDeskCounts(catalogue.db, ["catalogue"])).toEqual({ orders: 0, requests: 5, trialFollowUps: 7, outOfStock: 0 });
  expect([...catalogue.queries.keys()].sort()).toEqual(["admin_trial_follow_up_status", "enquiries", "trial_requests"]);
  expect(catalogue.queries.get("trial_requests")).toEqual({ select: "id", status: "eq.pending" });
  const finance = counter();
  expect(await staffDeskCounts(finance.db, ["finance"])).toEqual({ orders: 0, requests: 5, trialFollowUps: 0, outOfStock: 0 });
  expect([...finance.queries.keys()]).toEqual(["trade_applications"]);
});

test("zero counts are distinct from an unavailable source", async () => {
  expect(await staffDeskCounts(counter({}).db, ["warehouse", "catalogue", "finance"]))
    .toEqual({ orders: 0, requests: 0, trialFollowUps: 0, outOfStock: 0 });
  expect(await staffDeskCounts(counter({ ...counts, enquiries: "error" }).db, ["warehouse", "catalogue", "finance"]))
    .toEqual({ orders: 41, requests: null, trialFollowUps: 7, outOfStock: 4 });
});
