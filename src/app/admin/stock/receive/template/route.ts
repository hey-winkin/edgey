import { staffSession } from "@/lib/admin/auth";
import { deliveryTemplate } from "@/lib/admin/delivery-import";
import { canManageCosts } from "@/lib/admin/stock-cost-data";

export async function GET() {
  const staff = await staffSession();
  if (!staff?.roles.includes("warehouse")) return new Response(null, { status: 403 });
  return new Response(deliveryTemplate(canManageCosts(staff.roles)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="edgey-delivery-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
