import { checkCron } from "@/lib/payments/cron";
import { removeOrphanedEnquiryPhotos } from "@/lib/requests/photos";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const forbidden = checkCron(request);
  if (forbidden) return forbidden;
  try {
    return Response.json({ deleted: await removeOrphanedEnquiryPhotos() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not remove expired enquiry photos." }, { status: 500 });
  }
}
