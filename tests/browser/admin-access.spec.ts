import { randomUUID } from "node:crypto";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { expect, test, type Page } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { activateStaffFactor, enterStaffPassword, setVerifiedStaffSession, signInStaff, verifyNewStaffAuthenticator } from "./admin-fixtures";

const privatePaths = [
  "/admin", "/admin/warehouse", "/admin/warehouse/8028e331-bde6-4d32-97c4-7fcf1bed9190",
  "/admin/warehouse/8028e331-bde6-4d32-97c4-7fcf1bed9190/print", "/admin/stock",
  "/admin/stock/8028e331-bde6-4d32-97c4-7fcf1bed9190", "/admin/catalogue",
  "/admin/stock/receive", "/admin/stock/deliveries", "/admin/stock/deliveries/8028e331-bde6-4d32-97c4-7fcf1bed9190",
  "/admin/catalogue/8028e331-bde6-4d32-97c4-7fcf1bed9190", "/admin/finance", "/admin/requests", "/admin/sales",
];

async function setBuyerSession(page: Page, credentials: { email: string; password: string }, baseURL: string) {
  const jar = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: "edgey-auth" },
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (list) => { for (const cookie of list) jar.set(cookie.name, cookie); },
    },
  });
  const auth = await client.auth.signInWithPassword(credentials);
  expect(auth.error).toBeNull();
  const verified = await client.auth.getUser();
  expect(verified.data.user?.email).toBe(credentials.email);
  await page.context().addCookies([...jar.values()].map(({ name, value }) => ({
    name, value, url: baseURL, httpOnly: true, sameSite: "Lax",
  })));
}

test("anonymous users and signed-in buyers cannot reach any staff page", async ({ page, baseURL }) => {
  const checkAll = async () => {
    for (const path of privatePaths) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/sign-in$/);
      await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Staff areas" })).toHaveCount(0);
    }
    for (const kind of ["products", "daily"]) {
      const response = await page.request.get(`/admin/sales/export?kind=${kind}`);
      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(await response.text()).toBe("Staff sign-in required.");
    }
    expect((await page.request.get("/admin/stock/receive/template")).status()).toBe(403);
  };
  await checkAll();
  const buyer = await createLocalAdminUser("buyer");
  await page.getByLabel("Work email").fill(buyer.email);
  await page.getByLabel("Password").fill(buyer.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not sign in" })).toBeVisible();
  await setBuyerSession(page, { email: buyer.email, password: buyer.password }, baseURL!);
  await checkAll();
});

test("staff need an independently approved authenticator and private pages prohibit framing and caching", async ({ page }) => {
  const staff = await createLocalAdminUser("warehouse");
  await enterStaffPassword(page, staff);
  await expect(page.getByRole("button", { name: "Set up authenticator" })).toBeVisible();
  await expect(page.getByText(/the app generates the code; no email is sent/i)).toBeVisible();
  const response = await page.goto("/admin/stock");
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await expect(page.getByRole("navigation", { name: "Staff areas" })).toHaveCount(0);
  const stockRedirect = await response?.request().redirectedFrom()?.response();
  expect(stockRedirect?.headers()).toMatchObject({
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "permissions-policy": expect.stringContaining("microphone=()"),
    "content-security-policy": expect.stringContaining("frame-ancestors 'none'"),
    "cache-control": expect.stringContaining("no-store"),
  });
  expect(response?.headers()).toMatchObject({
    "referrer-policy": "same-origin",
    "cache-control": expect.stringContaining("no-store"),
  });
  const { factorId } = await verifyNewStaffAuthenticator(page);
  await page.goto("/admin/stock");
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await expect(page.getByRole("navigation", { name: "Staff areas" })).toHaveCount(0);
  await activateStaffFactor(staff, factorId);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Staff desk" })).toBeVisible();
});

test("staff sign-in explains where the code comes from and how to recover access", async ({ page, baseURL }) => {
  const staff = await createLocalAdminUser("warehouse");
  try {
    await setVerifiedStaffSession(page, staff, baseURL);
    await page.context().clearCookies();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/admin/sign-in");
    await expect(page.getByText(/next you’ll use an authenticator app, or set one up/i)).toBeVisible();
    await enterStaffPassword(page, staff);
    const code = page.getByLabel("Enter the 6-digit code from your authenticator app");
    await expect(code).toBeVisible();
    await expect(code).toHaveAccessibleDescription(/no email is sent/i);
    await expect(page.getByText(/ask the shop owner in person to reset it/i)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    const { error } = await localAdminClient().auth.admin.deleteUser(staff.id);
    if (error) throw error;
  }
});

test("a stale finance replay form cannot act after switching to a warehouse session", async ({ browser, page, baseURL }) => {
  const db = localAdminClient();
  const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
  const event = await db.rpc("record_provider_event", {
    p_provider: "stripe", p_event_id: eventId, p_event_type: "fixture.failed", p_payload: { fixture: true },
  });
  if (event.error) throw event.error;
  const failed = await db.rpc("mark_provider_event", {
    p_provider: "stripe", p_event_id: eventId, p_state: "failed", p_error: "Fixture did not process",
  });
  if (failed.error) throw failed.error;

  await signInStaff(page, await createLocalAdminUser("finance"));
  await page.goto("/admin/finance");
  const replay = page.getByRole("row").filter({ hasText: eventId }).getByRole("button", { name: "Reprocess event" });
  await expect(replay).toBeVisible();

  const warehouseContext = await browser.newContext({ baseURL });
  try {
    const warehousePage = await warehouseContext.newPage();
    await signInStaff(warehousePage, await createLocalAdminUser("warehouse"));
    for (const path of ["/admin/finance", "/admin/catalogue"]) {
      await warehousePage.goto(path);
      await expect(warehousePage).toHaveURL(/\/admin$/);
    }
    await page.context().clearCookies();
    await page.context().addCookies(await warehouseContext.cookies());
    await replay.click();
    await expect(page).toHaveURL(/\/admin$/);
    const { data } = await db.from("provider_events").select("state,last_error").eq("event_id", eventId).single();
    expect(data).toEqual({ state: "failed", last_error: "Fixture did not process" });
    const mark = await db.from("finance_retry_requests").select("kind").eq("target_id", eventId);
    expect(mark.error).toBeNull();
    expect(mark.data).toEqual([]);
  } finally {
    await warehouseContext.close();
  }
});

test("a stale stock form cannot act after switching to catalogue or finance", async ({ browser, page, baseURL }) => {
  const db = localAdminClient();
  const sku = "EDG-Z71";
  const original = await db.from("variants").select("id,stock_on_hand").eq("sku", sku).single();
  if (original.error) throw original.error;
  await signInStaff(page, await createLocalAdminUser("warehouse"));
  const warehouseCookies = await page.context().cookies();
  const path = `/admin/stock/${original.data.id}`;
  for (const role of ["catalogue", "finance"] as const) {
    const other = await browser.newContext({ baseURL });
    try {
      await page.context().clearCookies();
      await page.context().addCookies(warehouseCookies);
      await page.goto(path);
      await page.getByLabel("Received quantity").fill("1");
      const otherPage = await other.newPage();
      await signInStaff(otherPage, await createLocalAdminUser(role));
      await otherPage.goto(path);
      await expect(otherPage).toHaveURL(/\/admin$/);
      await otherPage.goto("/admin/stock/receive");
      await expect(otherPage).toHaveURL(/\/admin$/);
      await page.context().clearCookies();
      await page.context().addCookies(await other.cookies());
      await page.getByRole("button", { name: "Record stock receipt" }).click();
      await expect(page).toHaveURL(/\/admin$/);
    } finally {
      await other.close();
    }
  }
  const after = await db.from("variants").select("id,stock_on_hand").eq("sku", sku).single();
  expect(after.data).toEqual(original.data);
});

test("revoking warehouse membership takes effect on the next staff request", async ({ page }) => {
  const db = localAdminClient();
  const staff = await createLocalAdminUser("warehouse");
  await signInStaff(page, staff);
  const deleted = await db.from("staff_members").delete().eq("user_id", staff.id).eq("role", "warehouse");
  if (deleted.error) throw deleted.error;
  await page.goto("/admin/stock");
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
});
