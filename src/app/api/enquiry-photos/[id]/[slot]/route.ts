import { requireRequestsStaff } from "@/lib/admin/requests";
import { isWarehouseId } from "@/lib/admin/warehouse-format";
import { enquiryPhotoThumbnail } from "@/lib/requests/photo-image";
import { openEnquiryPhoto } from "@/lib/requests/photos";

export const runtime = "nodejs";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string; slot: string }> }) {
  const { db } = await requireRequestsStaff();
  const { id, slot } = await params;
  const missing = () => new Response("Photo not found.", { status: 404, headers: privateHeaders });
  if (!isWarehouseId(id) || !/^[1-3]$/.test(slot)) return missing();
  try {
    const { data, error } = await db.from("enquiries").select("id").eq("id", id).eq("kind", "compatibility").maybeSingle();
    if (error) throw error;
    if (!data) return missing();
    const photo = await openEnquiryPhoto(data.id, slot);
    if (!photo?.body) return missing();
    const preview = new URL(request.url).searchParams.get("size") === "thumb";
    const body = preview ? new Uint8Array(await enquiryPhotoThumbnail(await photo.arrayBuffer())) : photo.body;
    return new Response(body, { headers: { ...privateHeaders, "Content-Type": "image/jpeg" } });
  } catch {
    return new Response("Could not load the photo.", { status: 503, headers: privateHeaders });
  }
}
