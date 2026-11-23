import { openStaffMenu, signOutFromStaffMenu, switchTheme } from "../helpers/navigation";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { seedPaidAdminOrder, signInStaff } from "./admin-fixtures";

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
  await (await openStaffMenu(page)).getByRole("link", { name: "Pick and dispatch" }).click();
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
  await expect(page.getByLabel("Carrier")).toBeVisible();

  const dispatchedPath = `/admin/warehouse/${order.id}`;
  let submissions = 0;
  await page.route(`**${dispatchedPath}`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return route.continue();
    const results = await Promise.all([route.fetch(), route.fetch()]);
    submissions += results.filter((response) => response.ok()).length;
    await route.fulfill({ response: results[0]! });
  });
  await page.getByLabel("Carrier").fill("Fixture Courier");
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

test("a warehouse receipt updates the variant balance and ledger", async ({ page }) => {
  const db = localAdminClient();
  const sku = "EDG-Z16";
  const before = await db.from("variants").select("id,stock_on_hand").eq("sku", sku).single();
  if (before.error) throw before.error;
  const staff = await createLocalAdminUser("warehouse");
  await signInStaff(page, staff);
  await (await openStaffMenu(page)).getByRole("link", { name: "Stock and adjustments", exact: true }).click();
  await page.getByRole("link", { name: sku, exact: true }).click();
  await page.getByLabel("Received quantity").fill("3");
  await page.getByRole("button", { name: "Record stock receipt" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Stock receipt recorded." })).toBeVisible();
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
