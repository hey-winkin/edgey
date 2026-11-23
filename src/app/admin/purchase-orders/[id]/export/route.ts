import { z } from "zod";
import { staffSession } from "@/lib/admin/auth";
import { purchaseDocumentCsv } from "@/lib/admin/purchase-document";
import { readPurchaseDocument } from "@/lib/admin/purchase-document-data";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await staffSession();
  if (!staff?.roles.some((role) => role === "catalogue" || role === "finance")) {
    return new Response("Catalogue or finance access required.", { status: 403, headers });
  }

  const { id } = await params;
  if (!z.guid().safeParse(id).success) return new Response("Purchase order not found.", { status: 404, headers });
  try {
    const order = await readPurchaseDocument(staff.db, id);
    if (!order) return new Response("Purchase order not found.", { status: 404, headers });

    const name = /^PO-\d+$/.test(order.number) ? order.number : "purchase-order";
    return new Response("\uFEFF" + purchaseDocumentCsv(order), {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
      },
    });
  } catch {
    return new Response("Could not export the purchase order.", { status: 500, headers });
  }
}
