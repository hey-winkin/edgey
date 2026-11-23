import { expectTypeOf, test } from "vitest";
import type { Database, StaffPurchaseStatus } from "@/lib/supabase/database.types";

test("application types preserve constraints the Supabase generator cannot infer", () => {
  type Public = Database["public"];
  type SelectionQuote = Public["Functions"]["lookup_selection_quote"]["Returns"][number];

  expectTypeOf<SelectionQuote["option_label"]>().toEqualTypeOf<string | null>();
  expectTypeOf<SelectionQuote["photo"]>().toEqualTypeOf<string | null>();
  expectTypeOf<Public["Tables"]["staff_purchase_orders"]["Row"]["status"]>().toEqualTypeOf<StaffPurchaseStatus>();
  expectTypeOf<Public["Tables"]["staff_deliveries"]["Insert"]>().toBeNever();
  expectTypeOf<Public["Tables"]["staff_variant_suppliers"]["Insert"]>().toBeNever();
  expectTypeOf<Public["Functions"]["save_staff_purchase_order_with_supplier_parts"]["Args"]["p_id"]>().toEqualTypeOf<string | null>();
  expectTypeOf<Public["Functions"]["remember_staff_purchase_supplier_part"]["Args"]["p_expected_association_updated_at"]>().toEqualTypeOf<string | null>();
  expectTypeOf<Public["Tables"]["trial_follow_ups"]["Insert"]>().toBeNever();
  expectTypeOf<Public["Functions"]["admin_trial_follow_up_status"]["Returns"][number]["due_on"]>().toEqualTypeOf<string | null>();
  expectTypeOf<Public["Functions"]["record_trial_follow_up"]["Args"]["p_expected_id"]>().toEqualTypeOf<number | null>();
  expectTypeOf<Public["Views"]["staff_purchase_order_stock"]["Row"]["quantity"]>().toEqualTypeOf<number>();
});
