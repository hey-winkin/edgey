import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { serviceClient } from "@/lib/supabase/service";
import { sanitiseEnquiryPhoto } from "./photo-image";
import { photoLimit } from "./photo-limits";

const photoBucket = "enquiry-photos";
const accessSeconds = 60;
const uploadTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const photoName = /^[1-3]\.jpg$/;

type Public = Database["public"];
type PhotoDatabase = { public: Public & { Functions: {
  issue_enquiry_photo_upload: { Args: { p_enquiry_id: string; p_token_hash: string; p_photo_count: number }; Returns: boolean };
  claim_enquiry_photo_upload: { Args: { p_token_hash: string; p_photo_count: number }; Returns: string | null };
  enquiry_photo_storage_key: { Args: { p_enquiry_id: string }; Returns: string | null };
  orphaned_enquiry_photos: { Args: never; Returns: string[] };
} } };

const photoDb = () => serviceClient() as unknown as SupabaseClient<PhotoDatabase>;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issuePhotoUploadToken(id: string, count: FormDataEntryValue | null) {
  if (typeof count !== "string" || !/^[1-3]$/.test(count)) return;
  try {
    const token = randomBytes(32).toString("base64url");
    const { data, error } = await photoDb().rpc("issue_enquiry_photo_upload", {
      p_enquiry_id: id, p_token_hash: hashToken(token), p_photo_count: Number(count),
    }).abortSignal(AbortSignal.timeout(6_000));
    if (!error && data) return token;
  } catch {
  }
}

export async function saveEnquiryPhotos(token: string, files: FormDataEntryValue[]) {
  if (typeof token !== "string" || !uploadTokenPattern.test(token) || !files.length || files.length > photoLimit) return 0;

  const db = photoDb();
  const { data: key, error } = await db.rpc("claim_enquiry_photo_upload", {
    p_token_hash: hashToken(token), p_photo_count: files.length,
  });
  if (error || !key) return 0;
  const bucket = db.storage.from(photoBucket);
  const results = await Promise.allSettled(files.map(async (file, index) => {
    if (typeof file === "string") return false;
    const photo = await sanitiseEnquiryPhoto(file);
    if (!photo) return false;
    const { error: failure } = await bucket.upload(`${key}/${index + 1}.jpg`, photo, {
      contentType: "image/jpeg", cacheControl: "0", upsert: false,
    });
    return !failure;
  }));
  return results.filter((result) => result.status === "fulfilled" && result.value).length;
}

export async function listEnquiryPhotoSlots(id: string) {
  const db = photoDb();
  const { data: key, error: lookupError } = await db.rpc("enquiry_photo_storage_key", { p_enquiry_id: id });
  if (lookupError) return null;
  if (!key) return [];
  const { data, error } = await db.storage.from(photoBucket).list(key, {
    limit: photoLimit, sortBy: { column: "name", order: "asc" },
  });
  if (error) return null;
  return data.filter(({ name }) => photoName.test(name)).map(({ name }) => name[0]!);
}

export async function openEnquiryPhoto(id: string, slot: string) {
  if (!photoName.test(`${slot}.jpg`)) return null;
  const db = photoDb();
  const { data: key, error } = await db.rpc("enquiry_photo_storage_key", { p_enquiry_id: id });
  if (error) throw error;
  if (!key) return null;
  const { data } = await db.storage.from(photoBucket).createSignedUrl(`${key}/${slot}.jpg`, accessSeconds);
  if (!data) return null;
  const result = await fetch(data.signedUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  return result.ok ? result : null;
}

export async function removeOrphanedEnquiryPhotos() {
  const db = photoDb();
  const bucket = db.storage.from(photoBucket);
  const deadline = Date.now() + 40_000;
  let deleted = 0;
  for (let batch = 0; batch < 5 && Date.now() < deadline; batch++) {
    const { data: names, error } = await db.rpc("orphaned_enquiry_photos");
    if (error) throw error;
    if (!names.length) break;
    const { data, error: deletionError } = await bucket.remove(names);
    if (deletionError) throw deletionError;
    deleted += data.length;
    if (names.length < 200 || !data.length) break;
  }
  return deleted;
}
