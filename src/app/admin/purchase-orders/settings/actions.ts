"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminResult } from "@/app/admin/form";
import { requireStaff } from "@/lib/admin/auth";

const optional = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const settings = z.object({
  name: optional(200),
  address: optional(1000),
  email: optional(254).refine((value) => !value || z.email().safeParse(value).success),
  company_number: optional(80),
  vat_number: optional(80),
});

export async function savePurchaseBuyerSettings(_: AdminResult | null, form: FormData): Promise<AdminResult> {
  const { db } = await requireStaff("catalogue", "finance");
  const parsed = settings.safeParse(Object.fromEntries(
    Object.keys(settings.shape).map((key) => [key, form.get(key) ?? ""]),
  ));
  if (!parsed.success) return { ok: false, message: "Check the email and field lengths." };

  const { data, error } = await db.rpc("save_staff_purchase_buyer_settings", { p_settings: parsed.data });
  if (error || !data) return { ok: false, message: "Couldn’t save the buyer details. Check them and try again." };

  revalidatePath("/admin/purchase-orders/settings");
  return { ok: true, message: "Buyer details saved." };
}
