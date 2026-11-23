import { randomUUID } from "node:crypto";
import { Client } from "pg";
import sharp from "sharp";
import { expect, test, vi } from "vitest";
import { issuePhotoUploadToken, removeOrphanedEnquiryPhotos, saveEnquiryPhotos } from "@/lib/requests/photos";
import { photoByteLimit } from "@/lib/requests/photo-limits";
import { localAdminClient } from "../../scripts/seed-admin";

vi.mock("server-only", () => ({}));

test("only the server can claim one photo upload per recent match enquiry", async () => {
  localAdminClient();
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Use local Supabase.");
  const db = new Client({ connectionString: url, statement_timeout: 8000 });
  await db.connect();
  const [id, deliveryId, oldId, preservedId, expiredId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const storage = localAdminClient().storage.from("enquiry-photos");
  const paths: string[] = [];
  const issue = (enquiry: string) => db.query("select public.issue_enquiry_photo_upload($1,$2,1) as issued", [enquiry, "a".repeat(64)]);
  const bucketInfo = () => db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'enquiry-photos'");
  const oldObjects = () => db.query("select public.orphaned_enquiry_photos() as names");
  const photoKey = async (enquiry: string) =>
    (await db.query<{ key: string }>("select public.enquiry_photo_storage_key($1) as key", [enquiry])).rows[0]!.key;
  const submit = (enquiry: string) =>
    db.query("select public.submit_enquiry($1,'compatibility','fixture@example.test','Fixture enquiry')", [enquiry]);
  try {
    expect((await bucketInfo()).rows).toEqual([{ public: false, file_size_limit: String(photoByteLimit), allowed_mime_types: ["image/jpeg"] }]);
    for (const enquiry of [id, oldId, preservedId, expiredId]) await submit(enquiry);
    await db.query("select public.submit_enquiry($1,'delivery','fixture@example.test','Fixture enquiry',null,'SW1A 1AA')", [deliveryId]);
    await db.query("update public.enquiries set created_at = now() - interval '60 days' where id = $1", [oldId]);
    for (const role of ["anon", "authenticated"]) {
      await db.query(`set role ${role}`);
      await expect(issue(id)).rejects.toMatchObject({ code: "42501" });
      await expect(db.query("select public.claim_enquiry_photo_upload($1,1)", ["a".repeat(64)])).rejects.toMatchObject({ code: "42501" });
      await expect(photoKey(id)).rejects.toMatchObject({ code: "42501" });
      await expect(oldObjects()).rejects.toMatchObject({ code: "42501" });
      await db.query("reset role");
    }
    await db.query("set role service_role");
    expect((await issue(deliveryId)).rows).toEqual([{ issued: false }]);
    expect((await issue(oldId)).rows).toEqual([{ issued: false }]);
    await db.query("reset role");

    const clean = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#d4d2cc" } }).jpeg().toBuffer();
    const file = new File([new Uint8Array(clean)], "fixture.jpg", { type: "image/jpeg" });
    const expired = (await issuePhotoUploadToken(expiredId, "1"))!;
    await db.query("update private.enquiry_photo_uploads set expires_at = now() where enquiry_id = $1", [expiredId]);
    expect(await saveEnquiryPhotos(expired, [file])).toBe(0);
    const token = (await issuePhotoUploadToken(id, "2"))!;
    expect(await issuePhotoUploadToken(id, "2")).toBeUndefined();
    expect(await saveEnquiryPhotos(token, [file])).toBe(0);
    expect(await saveEnquiryPhotos(token.slice(0, -1) + (token.endsWith("0") ? "1" : "0"), [file, file])).toBe(0);
    const files = [file, new File(["not an image"], "bad.jpg", { type: "image/jpeg" })];
    expect((await Promise.all([saveEnquiryPhotos(token, files), saveEnquiryPhotos(token, files)])).sort()).toEqual([0, 1]);
    const key = await photoKey(id);
    paths.push(`${key}/1.jpg`);
    expect((await storage.list(key)).data?.map(({ name }) => name)).toEqual(["1.jpg"]);
    expect(await saveEnquiryPhotos((await issuePhotoUploadToken(preservedId, "1"))!, [file])).toBe(1);
    const keptKey = await photoKey(preservedId);
    paths.push(`${keptKey}/1.jpg`);
    await db.query("update public.enquiries set created_at = now() - interval '60 days', status = 'converted' where id = $1", [preservedId]);

    await db.query("delete from public.enquiries where id = $1", [id]);
    await submit(id);
    expect(await saveEnquiryPhotos((await issuePhotoUploadToken(id, "1"))!, [file])).toBe(1);
    const freshKey = await photoKey(id);
    expect(freshKey).not.toBe(key);
    paths.push(`${freshKey}/1.jpg`);
    expect((await oldObjects()).rows[0]?.names).not.toContain(paths[0]);
    await db.query("update storage.objects set created_at = now() - interval '2 hours' where bucket_id = 'enquiry-photos' and name = any($1)", [paths]);
    expect((await oldObjects()).rows[0]?.names).toEqual(expect.arrayContaining([paths[0]]));
    expect((await oldObjects()).rows[0]?.names).not.toContain(paths[1]);
    expect((await oldObjects()).rows[0]?.names).not.toContain(paths[2]);
    await removeOrphanedEnquiryPhotos();
    expect((await storage.list(key)).data).toEqual([]);
    expect((await storage.list(keptKey)).data?.map(({ name }) => name)).toEqual(["1.jpg"]);
    expect((await storage.list(freshKey)).data?.map(({ name }) => name)).toEqual(["1.jpg"]);
  } finally {
    await db.query("reset role");
    await storage.remove(paths);
    await db.query("delete from public.enquiries where id = any($1)", [[id, deliveryId, oldId, preservedId, expiredId]]);
    await db.end();
  }
});
