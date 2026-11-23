"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { AdminResult } from "@/app/admin/form";
import { requireStaff } from "@/lib/admin/auth";
import { purchaseDocumentCurrencies } from "@/lib/admin/purchase-document";

const path = "/admin/purchase-orders/suppliers";
const optional = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const supplier = z.object({
  name: z.string().trim().min(1).max(200),
  contact_name: optional(200),
  email: optional(254).refine((value) => !value || z.email().safeParse(value).success),
  phone: optional(80),
  address: optional(1000),
  default_currency: z.union([z.enum(purchaseDocumentCurrencies), z.literal("")]).transform((value) => value || null),
  lead_time_days: z.string().trim().regex(/^\d{0,10}$/).transform((value) => value ? Number(value) : null)
    .refine((value) => value === null || value <= 2_147_483_647),
  notes: optional(2000),
});

export async function savePurchaseSupplier(
  id: string | null, _: AdminResult | null, form: FormData,
): Promise<AdminResult> {
  const { db } = await requireStaff("catalogue", "finance");
  if (id !== null && !z.guid().safeParse(id).success) return { ok: false, message: "Invalid supplier reference." };

  const parsed = supplier.safeParse(Object.fromEntries(
    Object.keys(supplier.shape).map((key) => [key, form.get(key) ?? ""]),
  ));
  if (!parsed.success) {
    return { ok: false, message: "Enter a supplier name and check the email, lead time and field lengths." };
  }

  const { data, error } = await db.rpc("save_staff_supplier", { p_id: id, p_supplier: parsed.data });
  if (error || !data) return { ok: false, message: "Couldn’t save the supplier. Check the details and try again." };

  revalidatePath(path);
  if (!id) redirect(`${path}/${data}`);
  revalidatePath(`${path}/${id}`);
  return { ok: true, message: "Supplier saved." };
}
