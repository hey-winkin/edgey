import { openStaffMenu, signOutFromStaffMenu, switchTheme } from "../helpers/navigation";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb } from "../helpers/account-fixture";
import { seedPaidAdminOrder, setVerifiedStaffSession, signInStaff } from "./admin-fixtures";

test("staff sign in, print the paid order, then submit dispatch twice without moving stock twice", async ({ page }) => {
  const staff = await createLocalAdminUser("warehouse");
  const order = await seedPaidAdminOrder({ sku: "EDG-SUM-DRG-36" });
  const db = localAdminClient();
  const { data, error } = await db.from("orders").select("order_reference").eq("id", order.id).single();
  if (error) throw error;
  const reference = data.order_reference;
  expect(reference).toMatch(/^EDG-[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{5}$/);
  const stock = () => db.from("variants").select("stock_on_hand,stock_reserved").eq("id", order.variant.id).single();
  const before = await stock();
  expect(before.error).toBeNull();

  await signInStaff(page, staff);
  await (await openStaffMenu(page)).getByRole("link", { name: "New sales orders" }).click();
  const orderLink = page.getByRole("link", { name: reference, exact: true });
  await expect(orderLink).toHaveAttribute("href", `/admin/warehouse/${order.id}`);
  for (const lookup of [order.id, ` ${reference.toLowerCase()} `]) {
    await page.getByRole("textbox", { name: "Order reference" }).fill(lookup);
    await page.getByRole("button", { name: "Find order" }).click();
    const result = page.getByRole("table", { name: "Order lookup" });
    await expect(result.getByRole("row")).toHaveCount(2);
    await expect(result.getByRole("link", { name: reference, exact: true })).toBeVisible();
  }
  await orderLink.click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Printable pick list" }).click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
  const lines = page.getByRole("table", { name: "Pick lines" });
  await expect(lines.getByRole("cell", { name: order.variant.sku, exact: true })).toHaveCount(2);
  await expect(lines.getByRole("cell", { name: "36°", exact: true })).toBeVisible();
  await expect(lines.getByRole("cell", { name: String(order.quantity), exact: true })).toBeVisible();
  await expect(page.getByText(order.recipient, { exact: true })).toBeVisible();
  await expect(page.getByText(order.service, { exact: true })).toBeVisible();
  await expect(page.getByText("1 Fixture Lane", { exact: true })).toBeVisible();
  await expect(page.locator('time[datetime="2026-11-24"]')).toBeVisible();
  await page.getByRole("link", { name: "Back to order" }).click();
  await page.getByRole("button", { name: "Start picking" }).click();
  await expect(page.getByLabel("Carrier choice").locator("option:checked")).toHaveText("Other");
  await expect(page.getByLabel("Carrier", { exact: true })).toBeVisible();

  const dispatchedPath = `/admin/warehouse/${order.id}`;
  let submissions = 0;
  await page.route(`**${dispatchedPath}`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    const results = await Promise.all([route.fetch(), route.fetch()]);
    submissions += results.filter((response) => response.ok()).length;
    await route.fulfill({ response: results[0]! });
  });
  await page.getByLabel("Carrier", { exact: true }).fill("Fixture Courier");
  await page.getByLabel("Tracking number").fill("SHIP-TEST-001");
  await page.getByRole("button", { name: "Record dispatch" }).click();
  await expect(page.getByText("SHIP-TEST-001", { exact: true })).toBeVisible();
  expect(submissions).toBe(2);
  const after = await stock();
  expect(after.data).toEqual({
    stock_on_hand: before.data!.stock_on_hand - order.quantity,
    stock_reserved: before.data!.stock_reserved - order.quantity,
  });
  const movements = await db.from("stock_movements").select("on_hand_delta")
    .eq("order_id", order.id).eq("kind", "dispatch");
  expect(movements.data).toEqual([{ on_hand_delta: -order.quantity }]);

  await page.unrouteAll({ behavior: "wait" });
  await page.getByLabel("Dispatched line").selectOption(order.variant.id);
  await page.getByLabel("Returned quantity").fill("1");
  await page.getByLabel("Return category").selectOption("wrong_fit");
  await page.getByLabel("Reported blade lookup code", { exact: false }).fill("Other-329");
  await page.getByLabel("Return reason").fill("Unopened return");
  await page.getByRole("button", { name: "Record return", exact: true }).click();
  await expect(page.getByText("Unopened return")).toBeVisible();
  await expect(page.getByText("No attributable code")).toBeVisible();
  await expect(page.getByText("Other-329", { exact: true })).toBeVisible();
  expect((await stock()).data).toEqual(after.data);
  await page.getByLabel("Saleable quantity to restore").fill("1");
  await page.getByRole("button", { name: "Restore inspected units" }).click();
  await expect(page.getByText("All units from this return have been restored.")).toBeVisible();
  expect((await stock()).data?.stock_on_hand).toBe(after.data!.stock_on_hand + 1);

  await signOutFromStaffMenu(page);
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  await page.goto(dispatchedPath);
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
});

test("dispatch matches the saved service, rejects stale choices and works from a native form", async ({ page, browser, baseURL }) => {
  const db = await connectAccountDb();
  const service = "Fixture tracked overnight";
  const native = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 860 } });
  try {
    await db.query(`insert into public.delivery_rules (scope, code, kind, service_name, dispatch_carrier, charge_ex_vat_pence, working_days)
      values ('district', 'SW98', 'next-working-day', $1, 'Fixture Parcel', 695, 1)`, [service]);
    const quote = await localAdminClient().rpc("checkout_delivery_terms", { p_postcode: "SW98 1AA" });
    expect(quote.error).toBeNull();
    expect(quote.data).toMatchObject({ quote: { serviceName: service } });
    expect(JSON.stringify(quote.data)).not.toContain("Fixture Parcel");

    const order = await seedPaidAdminOrder({ sku: "EDG-Z50", service });
    const path = `/admin/warehouse/${order.id}`;
    await setVerifiedStaffSession(page, await createLocalAdminUser("warehouse"), baseURL);
    await page.goto(path);
    await page.getByRole("button", { name: "Start picking" }).click();
    const selection = page.getByRole("combobox", { name: "Carrier choice" });
    const manual = page.getByRole("textbox", { name: "Carrier", exact: true });
    await expect(selection.locator("option:checked")).toHaveText(`Fixture Parcel · ${service}`);
    await expect(manual).toBeHidden();
    const renders = process.env.EDGEY_STAFF_CARRIER_RENDERS;
    if (renders) await mkdir(renders, { recursive: true });
    const dispatch = page.getByRole("heading", { name: "Dispatch", exact: true }).locator("..");
    for (const theme of ["dark", "light"] as const) {
      await switchTheme(page, theme);
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 860 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        if (renders) await dispatch.screenshot({ path: join(renders, `warehouse-carrier-default-${theme}-${width}.png`) });
      }
    }

    await db.query("update public.delivery_rules set dispatch_carrier = 'Fixture Express' where scope = 'district' and code = 'SW98'");
    await page.getByLabel("Tracking number").fill("TRACK-STALE");
    await page.getByRole("button", { name: "Record dispatch" }).click();
    await expect(dispatch.getByRole("alert")).toContainText("carrier service is no longer configured");
    await expect(page.getByLabel("Tracking number")).toHaveValue("TRACK-STALE");
    const readShipment = () => localAdminClient().from("orders").select("carrier,delivery_service,tracking_number,fulfilment_status").eq("id", order.id).single();
    expect((await readShipment()).data).toEqual({
      carrier: null, delivery_service: service, tracking_number: null, fulfilment_status: "picking",
    });

    const nativePage = await native.newPage();
    await setVerifiedStaffSession(nativePage, await createLocalAdminUser("warehouse"), baseURL);
    await nativePage.goto(path);
    const nativeChoice = nativePage.getByRole("combobox", { name: "Carrier choice" });
    const nativeManual = nativePage.getByRole("textbox", { name: "Carrier", exact: true });
    await expect(nativeChoice.locator("option:checked")).toHaveText(`Fixture Express · ${service}`);
    await nativeChoice.press("End");
    await nativeChoice.press("Tab");
    await expect(nativeManual).toBeFocused();
    await nativeManual.fill("Fixture Extra");
    await nativeChoice.selectOption({ label: `Fixture Express · ${service}` });
    await expect(nativeManual).toBeHidden();
    await nativeChoice.press("End");
    await expect(nativeManual).toHaveValue("Fixture Extra");
    if (renders) await nativePage.getByRole("heading", { name: "Dispatch", exact: true }).locator("..")
      .screenshot({ path: join(renders, "warehouse-carrier-other-native-390.png") });
    await nativeChoice.selectOption({ label: `Fixture Express · ${service}` });
    await nativePage.getByLabel("Tracking number").fill("TRACK-NATIVE");
    await nativePage.getByRole("button", { name: "Record dispatch" }).click();
    await expect(nativePage.getByText("TRACK-NATIVE", { exact: true })).toBeVisible();
    expect((await readShipment()).data).toEqual({
      carrier: "Fixture Express", delivery_service: service, tracking_number: "TRACK-NATIVE", fulfilment_status: "dispatched",
    });
  } finally {
    await native.close();
    try {
      await db.query("delete from public.delivery_rules where scope = 'district' and code = 'SW98' and service_name = $1", [service]);
    } finally {
      await db.end();
    }
  }
});

test("a warehouse receipt updates the variant balance and ledger", async ({ page }) => {
  const db = localAdminClient();
  const sku = "EDG-Z16";
  const before = await db.from("variants").select("id,stock_on_hand").eq("sku", sku).single();
  if (before.error) throw before.error;
  const staff = await createLocalAdminUser("warehouse");
  await signInStaff(page, staff);
  await (await openStaffMenu(page)).getByRole("link", { name: "Adjust stock", exact: true }).click();
  await page.getByRole("link", { name: sku, exact: true }).click();
  const receive = page.getByRole("link", { name: "Book in a delivery", exact: true });
  await expect(receive).toHaveAttribute("href", "/admin/stock/receive");
  await receive.click();
  await page.getByRole("link", { name: "Receive without a purchase order", exact: true }).click();
  const reference = `Warehouse stock receipt ${staff.id.slice(0, 8)}`;
  await page.getByLabel("Delivery reference").fill(reference);
  await page.getByLabel("Blade code for line 1").fill(sku);
  await page.getByLabel("Quantity for line 1").fill("3");
  await page.getByRole("button", { name: "Review delivery" }).click();
  await page.getByRole("button", { name: "Receive stock", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: reference, exact: true })).toBeVisible();
  await page.getByRole("link", { name: sku, exact: true }).click();
  await expect(page.getByRole("table", { name: "Movement ledger" }).getByRole("row").filter({ hasText: "Receive" }).filter({ hasText: "+3" }).first()).toBeVisible();
  const after = await db.from("variants").select("stock_on_hand").eq("id", before.data.id).single();
  expect(after.data?.stock_on_hand).toBe(before.data.stock_on_hand + 3);
});

test("warehouse screens keep horizontal scrolling inside tables and show keyboard focus in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signInStaff(page, await createLocalAdminUser("warehouse"));
  for (const theme of ["dark", "light"] as const) {
    if (theme === "light") await switchTheme(page, "light");
    for (const width of [820, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/admin/warehouse", "/admin/stock"]) {
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        expect(overflow).toBe(false);
        await page.keyboard.press("Tab");
        const skip = page.getByRole("link", { name: "Skip to main content" });
        await expect(skip).toBeFocused();
        await expect(skip).toHaveCSS("outline-color", theme === "dark" ? "rgb(155, 227, 249)" : "rgb(33, 93, 173)");
      }
    }
  }
});
