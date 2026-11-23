import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { serviceClient } from "@/lib/supabase/service";
import { canReceivePurchaseOrder, type PurchaseReceiptTarget } from "./purchase-orders";
import { stockSchemaUnavailable } from "./stock-cost-data";

type StaffDb = SupabaseClient<Database>;

export async function getPurchaseStock(db: StaffDb, variantIds: string[]) {
  if (!variantIds.length) return new Map<string, Database["public"]["Views"]["staff_purchase_order_stock"]["Row"]>();
  const { data, error } = await db.from("staff_purchase_order_stock")
    .select("variant_id,quantity,expected_on,has_undated").in("variant_id", variantIds);
  if (error) return null;
  return new Map(data.map((row) => [row.variant_id, row]));
}

export async function getPurchaseReceipt(db: StaffDb, id: string) {
  const { data, error } = await db.from("staff_purchase_orders")
    .select("id,number,status,revision,staff_purchase_order_lines(variant_id,sku,blade_name,option_label,quantity,received_quantity,position)")
    .eq("id", id).order("position", { referencedTable: "staff_purchase_order_lines" }).maybeSingle();
  if (error) {
    if (stockSchemaUnavailable(error)) return { kind: "unavailable" } as const;
    throw new Error("Could not load the purchase order.");
  }
  if (!data) return { kind: "missing" } as const;
  if (!canReceivePurchaseOrder(data.status)) return { kind: "closed", id, number: data.number } as const;
  const order: PurchaseReceiptTarget = {
    id: data.id, number: data.number, revision: data.revision,
    lines: data.staff_purchase_order_lines.map((line) => ({
      variantId: line.variant_id, sku: line.sku, bladeName: [line.blade_name, line.option_label].filter(Boolean).join(" · "),
      outstanding: Math.max(line.quantity - line.received_quantity, 0),
    })),
  };
  return { kind: "open", order } as const;
}

export async function getAddablePurchaseVariant(id: string) {
  const { data, error } = await serviceClient().from("variants")
    .select("sku,option_label,products(name)").eq("id", id).neq("publication_status", "archived").maybeSingle();
  if (error) throw new Error("Could not find this blade in the catalogue.");
  return data;
}
