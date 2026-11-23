import { expectTypeOf, test } from "vitest";
import type { Database, StaffPurchaseStatus } from "@/lib/supabase/database.types";

test("application types preserve constraints the Supabase generator cannot infer", () => {
  type Public = Database["public"];
  type SelectionQuote = Public["Functions"]["lookup_selection_quote"]["Returns"][number];

  expectTypeOf<SelectionQuote["option_label"]>().toEqualTypeOf<string | null>();
  expectTypeOf<SelectionQuote["photo"]>().toEqualTypeOf<string | null>();
  expectTypeOf<Public["Tables"]["staff_purchase_orders"]["Row"]["status"]>().toEqualTypeOf<StaffPurchaseStatus>();
  expectTypeOf<Public["Tables"]["staff_deliveries"]["Insert"]>().toBeNever();
  expectTypeOf<Public["Views"]["staff_purchase_order_stock"]["Row"]["quantity"]>().toEqualTypeOf<number>();
});
