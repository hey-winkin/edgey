import { dispatchDate } from "@/lib/admin/warehouse-format";
import type { Database } from "@/lib/supabase/database.types";

export function OnOrder({ summary, variantId }: {
  summary: ReadonlyMap<string, Database["public"]["Views"]["staff_purchase_order_stock"]["Row"]> | null;
  variantId: string;
}) {
  if (!summary) return <span className="admin-muted">Unavailable</span>;
  const stock = summary.get(variantId);
  if (!stock) return <span className="admin-mono">0</span>;
  return <>
    <span className="admin-mono">{stock.quantity.toLocaleString("en-GB")}</span>
    <span className="admin-muted block">{stock.expected_on
      ? <>Next: <time dateTime={stock.expected_on}>{dispatchDate(stock.expected_on)}</time>{stock.has_undated && <span className="block">Some dates not set</span>}</>
      : "Date not set"}</span>
  </>;
}
