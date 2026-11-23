import "server-only";

import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/admin/auth";
import { catalogueCodeMaxLength, catalogueStatuses, getOrderableCatalogueIds } from "@/lib/admin/catalogue";
import { orderStockHref } from "@/lib/admin/navigation";
import { getPurchaseVariants } from "@/lib/admin/purchase-catalogue";
import { purchaseRoles } from "@/lib/admin/roles";
import { readRunningLow, runningLowView } from "@/lib/admin/running-low";
import { encodeStockSelection, stockSelectionLimit } from "@/lib/admin/stock-selection";

type StockListContext = {
  filters: { q?: string; status?: string; brand?: string };
  page: number;
  pageIds: string[];
  offPageIds: string[];
  runningLow?: boolean;
};

export async function getActiveStockSelection(ids: string[]) {
  const variants = await getPurchaseVariants(ids);
  return ids.filter((id) => {
    const variant = variants.get(id);
    return variant && variant.status !== "archived";
  });
}

export async function submitStockSelection({ filters, page, pageIds, offPageIds, runningLow }: StockListContext, form: FormData) {
  const { db, roles } = await requireStaff(...purchaseRoles);
  const intent = form.get("intent");
  const query = new URLSearchParams();
  if (intent === "filter" || intent === "select-matching") {
    const q = form.get("q");
    const status = form.get("status");
    const brand = form.get("brand");
    if (typeof q === "string" && q.trim()) query.set("q", q.trim().slice(0, catalogueCodeMaxLength));
    if (catalogueStatuses.some((value) => value === status)) query.set("status", String(status));
    if (typeof brand === "string" && /^[a-z0-9-]{1,80}$/.test(brand)) query.set("brand", brand);
  } else if (intent !== "clear-filters") {
    for (const [key, value] of Object.entries(filters)) {
      if (value) query.set(key, value);
    }
    const nextPage = intent === "previous" ? page - 1 : intent === "next" ? page + 1 : page;
    if (nextPage > 1) query.set("page", String(nextPage));
  }
  const checked = new Set(form.getAll("variant"));
  const ids = intent === "clear-selection" ? [] : [
    ...offPageIds,
    ...pageIds.filter((id) => intent === "select-page" || (intent !== "clear-page" && checked.has(id))),
  ];
  const active = await getActiveStockSelection(ids);
  let matching = active;
  if (intent === "select-matching") {
    const scope = runningLow ? await readRunningLow(db) ?? [] : undefined;
    const matches = await getOrderableCatalogueIds(roles, Object.fromEntries(query), scope);
    matching = [...new Set([...active, ...matches])];
  }
  const tooMany = matching.length > stockSelectionLimit;
  const token = encodeStockSelection(tooMany ? active : matching);
  const notice = tooMany ? intent === "select-matching" ? "matching-limit" : "limit" :
    active.length < ids.length ? "removed" : intent === "order" && !active.length ? "empty" : undefined;
  if (intent === "order" && token && !notice) redirect(`${orderStockHref}?variants=${token}`);

  if (runningLow) query.set("view", runningLowView);
  if (token || runningLow) query.set("selected", token);
  if (notice) query.set("selectionNotice", notice);
  redirect(`/admin/catalogue${query.size ? `?${query}` : ""}#stock-results`);
}
