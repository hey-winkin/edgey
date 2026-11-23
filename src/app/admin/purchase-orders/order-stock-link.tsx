import Link from "next/link";
import { orderStockHref, orderStockLabel } from "@/lib/admin/navigation";

export function OrderStockLink({ variant }: { variant?: { id: string; sku?: string } }) {
  return <Link
    href={variant ? `${orderStockHref}?variant=${variant.id}` : orderStockHref}
    prefetch={false}
    className={variant?.sku ? "admin-secondary" : "primary"}
    aria-label={variant?.sku ? `${orderStockLabel} for ${variant.sku}` : undefined}
  >{orderStockLabel}</Link>;
}
