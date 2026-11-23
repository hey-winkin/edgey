import type { requireStaff } from "@/lib/admin/auth";
import type { PurchaseDefaults, SupplierAssociation } from "./supplier-defaults";

type StaffDb = Awaited<ReturnType<typeof requireStaff>>["db"];

export async function loadPurchaseAssociations(db: StaffDb, ids: string[]): Promise<SupplierAssociation[]> {
  const batchSize = 40;
  const pages = await Promise.all(Array.from({ length: Math.ceil(ids.length / batchSize) }, async (_, index) => {
    const rows: SupplierAssociation[] = [];
    const pageSize = 500;
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await db.from("staff_variant_suppliers")
        .select("variant_id, supplier_id, supplier_part_number, is_usual, updated_at")
        .in("variant_id", ids.slice(index * batchSize, (index + 1) * batchSize))
        .order("variant_id").order("supplier_id").range(start, start + pageSize - 1);
      if (error) throw new Error("Could not load the products’ supplier details.");
      rows.push(...data);
      if (data.length < pageSize) return rows;
    }
  }));
  return pages.flat();
}

export async function loadPurchaseRates(db: StaffDb, id?: string): Promise<PurchaseDefaults["rates"]> {
  const rates: PurchaseDefaults["rates"] = {};
  await Promise.all((["USD", "EUR"] as const).map(async (currency) => {
    let query = db.from("staff_purchase_orders")
      .select("number, ordered_on, staff_purchase_order_costs!inner(currency, exchange_rate)")
      .in("status", ["sent", "part_received", "received", "closed"])
      .eq("staff_purchase_order_costs.currency", currency)
      .gt("staff_purchase_order_costs.exchange_rate", 0);
    if (id) query = query.neq("id", id);
    const { data, error } = await query.order("ordered_on", { ascending: false })
      .order("created_at", { ascending: false }).order("id").limit(1).maybeSingle();
    if (error) {
      console.error("Could not load the previous purchase exchange rate.");
      return;
    }
    const rate = data?.staff_purchase_order_costs?.exchange_rate;
    if (data && typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      rates[currency] = { value: rate.toLocaleString("en-GB", { useGrouping: false, maximumFractionDigits: 8 }),
        number: data.number, ordered: data.ordered_on };
    }
  }));
  return rates;
}
