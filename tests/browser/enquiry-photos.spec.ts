import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { photoByteLimit, photoEdgeLimit } from "../../src/lib/requests/photo-limits";
import { saveThemeBeforeLoad, scanAccessibility, themes } from "../helpers/accessibility";
import { connectAccountDb } from "../helpers/account-fixture";
import { switchTheme } from "../helpers/navigation";
import { setVerifiedStaffSession } from "./admin-fixtures";
import { enquiryPhotoFixture, maxSizeEnquiryJpeg } from "./fixtures/enquiry-photo";

test.use({ trace: "off" });

const viewports = [
  { width: 1440, height: 960 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
];

async function render(page: Page, name: string) {
  const folder = process.env.EDGEY_ENQUIRY_PHOTO_RENDERS;
  if (!folder) return;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: join(folder, name + ".png"), fullPage: true });
}

test("previews selected photos and fits the enquiry in both themes at trade-buyer sizes", async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const photo = await enquiryPhotoFixture();
  for (const viewport of viewports) {
    const mobile = viewport.width <= 390;
    const context = await browser.newContext({ baseURL, viewport, hasTouch: mobile, isMobile: mobile, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      await saveThemeBeforeLoad(page, "dark");
      await page.goto("/enquiry?q=DEMO-BLADE");
      const picker = page.getByLabel("Add photos", { exact: true });
      const section = page.getByRole("group", { name: "Photos (optional)" });
      await expect(section).toBeVisible();
      if (mobile) await expect(page.getByLabel("Take photo")).toHaveAttribute("capture", "environment");
      await picker.focus();
      await expect(picker).toBeFocused();
      await expect(picker.locator("..")).toHaveCSS("outline-style", "solid");
      await picker.setInputFiles([photo, photo]);
      await expect(section.getByRole("status")).toHaveText("2 of 3 photos ready");
      await expect.poll(() => section.locator("img").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(photoEdgeLimit);
      for (const theme of themes) {
        if (theme === "light") await switchTheme(page, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
        await scanAccessibility(page, theme);
        await render(page, `buyer-${theme}-${viewport.width}`);
      }
      await section.getByRole("button", { name: "Remove photo 1" }).click();
      await expect(section.getByRole("status")).toHaveText("1 of 3 photos ready");
      await expect(picker).toBeFocused();
    } finally {
      await context.close();
    }
  }
});

test("saves only retained photos, protects the bucket and lets enquiry staff open the full photo", async ({ page, browser, baseURL }) => {
  test.setTimeout(75_000);
  const admin = localAdminClient();
  const buyerDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const db = await connectAccountDb();
  const email = `photo-${randomUUID()}@example.test`;
  const storage = admin.storage.from("enquiry-photos");
  const photo = await enquiryPhotoFixture();
  const [catalogue, finance] = await Promise.all([createLocalAdminUser("catalogue"), createLocalAdminUser("finance")]);
  let key: string | undefined;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/enquiry?q=DEMO-BLADE");
    const picker = page.getByLabel("Add photos", { exact: true });
    const section = page.getByRole("group", { name: "Photos (optional)" });
    await picker.setInputFiles({ name: "demo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await expect(section.getByRole("status")).toHaveText(/Choose a JPEG/);
    await picker.setInputFiles([photo, photo, photo, photo]);
    await expect(section.getByRole("status")).toHaveText("You can attach up to three photos.");
    await expect(section.getByRole("button", { name: /Remove photo/ })).toHaveCount(3);
    await expect(picker).toBeDisabled();
    await section.getByRole("button", { name: "Remove photo 3" }).click();
    await page.getByLabel("Reply email").fill(email);
    const send = page.getByRole("button", { name: "Send enquiry" });
    await send.click();
    await expect(page.getByRole("heading", { name: "Check the form" })).toBeFocused();
    await expect(section.getByRole("button", { name: /Remove photo/ })).toHaveCount(2);
    await section.getByRole("button", { name: "Remove photo 2" }).click();
    await page.getByLabel("Message").fill("Which blade fits this holder? This is a fictional test enquiry.");
    await send.click();
    await expect(page.getByRole("heading", { name: "Enquiry received" })).toBeFocused();
    await expect(page.getByRole("status")).toContainText("1 photo attached.");

    const result = await admin.from("enquiries").select("id").eq("email", email).single();
    if (result.error) throw result.error;
    const id = result.data.id;
    const lookup = await db.query<{ key: string }>("select public.enquiry_photo_storage_key($1) as key", [id]);
    key = lookup.rows[0]!.key;
    const path = `${key}/1.jpg`;
    const stored = await storage.download(path);
    if (stored.error) throw stored.error;
    expect(stored.data.size).toBeLessThanOrEqual(photoByteLimit);
    expect(await sharp(Buffer.from(await stored.data.arrayBuffer())).metadata()).toMatchObject({
      width: photoEdgeLimit, height: 1120, format: "jpeg",
    });
    expect((await storage.list(key)).data?.map(({ name }) => name)).toEqual(["1.jpg"]);
    expect((await buyerDb.storage.from("enquiry-photos").createSignedUrl(path, 60)).error).not.toBeNull();
    expect((await buyerDb.storage.from("enquiry-photos").download(path)).error).not.toBeNull();
    const unsigned = new URL(`/storage/v1/object/public/enquiry-photos/${path}`, process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect((await page.request.get(unsigned.href)).ok()).toBe(false);

    const detail = `/admin/requests/enquiries/${id}`;
    const attachment = `/api/enquiry-photos/${id}/1`;
    await page.goto(attachment);
    await expect(page).toHaveURL(/\/admin\/sign-in/);
    const financeContext = await browser.newContext({ baseURL });
    try {
      const financePage = await financeContext.newPage();
      await setVerifiedStaffSession(financePage, finance, baseURL);
      await financePage.goto(attachment);
      await expect(financePage).toHaveURL(/\/admin$/);
    } finally {
      await financeContext.close();
    }

    await setVerifiedStaffSession(page, catalogue, baseURL);
    await saveThemeBeforeLoad(page, "dark");
    await page.goto(detail);
    await expect(page.getByRole("heading", { name: "Buyer photos" })).toBeVisible();
    const link = page.getByRole("link", { name: "Open photo 1 full size" });
    await expect.poll(() => link.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
    for (const theme of themes) {
      if (theme === "light") await switchTheme(page, theme);
      await scanAccessibility(page, theme);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
        await render(page, `staff-${theme}-${viewport.width}`);
      }
    }
    const popupPromise = page.waitForEvent("popup");
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState("load");
    const photoUrl = new URL(popup.url());
    expect(photoUrl.pathname).toBe(attachment);
    expect(photoUrl.search).toBe("");
    await expect.poll(() => popup.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(photoEdgeLimit);
    const media = await page.request.get(attachment);
    expect(media.headers()["cache-control"]).toBe("private, no-store");
    expect(media.headers()["content-type"]).toBe("image/jpeg");
    expect((await page.request.get(`/api/enquiry-photos/${id}/4`)).status()).toBe(404);
    expect((await page.request.get(`/api/enquiry-photos/${randomUUID()}/1`)).status()).toBe(404);
    await popup.close();
  } finally {
    if (key) await storage.remove([`${key}/1.jpg`, `${key}/2.jpg`, `${key}/3.jpg`]);
    await db.query("delete from public.enquiries where email = $1", [email]);
    await db.end();
    await Promise.all([catalogue, finance].map((staff) => admin.auth.admin.deleteUser(staff.id)));
  }
});

test("uploads three photos at the total payload limit through the real server action", async ({ page }) => {
  const admin = localAdminClient();
  const db = await connectAccountDb();
  const email = `max-photos-${randomUUID()}@example.test`;
  const photo = await enquiryPhotoFixture();
  const jpeg = await maxSizeEnquiryJpeg();
  expect(Buffer.byteLength(jpeg, "base64")).toBe(photoByteLimit);
  try {
    await page.addInitScript((jpeg) => {
      const bytes = Uint8Array.from(atob(jpeg), (character) => character.charCodeAt(0));
      HTMLCanvasElement.prototype.toBlob = (callback) => callback(new Blob([bytes], { type: "image/jpeg" }));
    }, jpeg);
    await page.goto("/enquiry");
    await page.getByLabel("Reply email").fill(email);
    await page.getByLabel("Message").fill("Fictional enquiry with three photos.");
    await page.getByLabel("Add photos", { exact: true }).setInputFiles([photo, photo, photo]);
    await expect(page.getByRole("group", { name: "Photos (optional)" }).getByRole("status")).toHaveText("3 of 3 photos ready");
    await page.getByRole("button", { name: "Send enquiry" }).click();
    await expect(page.getByText("3 photos attached.", { exact: true })).toBeVisible();
  } finally {
    const key = (await db.query<{ key: string }>("select public.enquiry_photo_storage_key(id) as key from public.enquiries where email = $1", [email])).rows[0]?.key;
    if (key) await admin.storage.from("enquiry-photos").remove([`${key}/1.jpg`, `${key}/2.jpg`, `${key}/3.jpg`]);
    await db.query("delete from public.enquiries where email = $1", [email]);
    await db.end();
  }
});

for (const outcome of ["connection drops", "connection stalls"]) {
  test(`confirms the enquiry while uploading and explains a failure when the ${outcome}`, async ({ page }) => {
    const admin = localAdminClient();
    const db = await connectAccountDb();
    const email = `photo-failure-${randomUUID()}@example.test`;
    try {
      if (outcome === "connection stalls") await page.clock.install();
      const { promise, resolve } = Promise.withResolvers<void>();
      await page.route("**/enquiry", async (route) => {
        if (!route.request().postDataBuffer()?.includes(Buffer.from('filename="photo.jpg"'))) return route.continue();
        await promise;
        await route.abort("connectionreset");
      });
      await page.goto("/enquiry");
      await page.getByLabel("Reply email").fill(email);
      await page.getByLabel("Message").fill("Please help match this fictional blade.");
      await page.getByLabel("Add photos", { exact: true }).setInputFiles(await enquiryPhotoFixture());
      await expect(page.getByRole("group", { name: "Photos (optional)" }).getByRole("status")).toHaveText("1 of 3 photos ready");
      await page.getByRole("button", { name: "Send enquiry" }).click();
      try {
        await expect(page.getByRole("heading", { name: "Enquiry received" })).toBeFocused();
        await expect(page.getByText("Uploading photos. Keep this page open.")).toBeVisible();
        expect((await admin.from("enquiries").select("id").eq("email", email).single()).error).toBeNull();
        if (outcome === "connection stalls") {
          await page.clock.fastForward(76_000);
          await expect(page.getByRole("status")).toContainText("We couldn’t confirm your photo upload.");
        }
      } finally {
        resolve();
      }
      await expect(page.getByRole("heading", { name: "Enquiry received" })).toBeFocused();
      await expect(page.getByRole("status")).toContainText("We couldn’t confirm your photo upload.");
      await page.goto("/enquiry?kind=delivery");
      await expect(page.getByRole("group", { name: "Photos (optional)" })).toHaveCount(0);
    } finally {
      await db.query("delete from public.enquiries where email = $1", [email]);
      await db.end();
    }
  });
}
