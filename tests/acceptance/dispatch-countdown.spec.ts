import { readFile } from "node:fs/promises";
import { expect, test, type Locator } from "@playwright/test";
import { addBlade, database, dispatchAt, selection, summary } from "./storefront-fixtures";

const blade = "/blades/edg-z10";
const today = "Order before 15:30 UK time for dispatch today, Monday 23 November.";
const tomorrow = "Dispatches Tuesday 24 November";
const countdown = /^(?:Order within .+ for dispatch today|Less than 1 min to order for dispatch today|Dispatches .+)$/;
const notice = (scope: Locator) => scope.locator("time").filter({ hasText: countdown });

test.use({ timezoneId: "America/Los_Angeles" });

let previousClock: string;
test.beforeEach(async () => { previousClock = await readFile(process.env.ACCEPTANCE_CLOCK_FILE!, "utf8"); });
test.afterEach(async () => { await dispatchAt(previousClock); });

test("quotes one dispatch window across the buyer journey and updates the live checkout at cutoff", async ({ browser, page, baseURL }) => {
  const before = "2026-11-23T13:19:30Z";
  await dispatchAt(before);
  const withoutScripts = await browser.newPage({ javaScriptEnabled: false });
  try {
    await withoutScripts.goto(new URL(blade, baseURL).href);
    await expect(withoutScripts.getByRole("heading", { name: "Flat-stock drag blade" })).toBeVisible();
    await expect(notice(withoutScripts.locator("main"))).toHaveCount(0);
  } finally {
    await withoutScripts.close();
  }

  await page.clock.install({ time: new Date(before) });
  await page.goto(blade);
  await expect(notice(page.locator("main"))).toHaveText("Order within 2 h 10 min for dispatch today");
  await addBlade(page);
  const basket = selection(page);
  await expect(notice(basket)).toHaveText("Order within 2 h 10 min for dispatch today");
  await basket.getByRole("link", { name: "Go to checkout" }).click();
  const order = summary(page);
  await expect(notice(order)).toHaveText("Order within 2 h 10 min for dispatch today");
  const status = order.getByRole("status").filter({ hasText: today });
  await expect(status).toHaveCount(1);
  await status.evaluate((node) => {
    node.setAttribute("data-change-count", "0");
    new MutationObserver(() => node.setAttribute("data-change-count", "1"))
      .observe(node, { childList: true, characterData: true, subtree: true });
  });

  await page.clock.fastForward(60_000);
  await expect(notice(order)).toHaveText("Order within 2 h 9 min for dispatch today");
  await expect(status).toHaveAttribute("data-change-count", "0");
  await expect(order.getByText("Estimated delivery", { exact: true })).toHaveCount(0);

  await page.getByLabel("Postcode").fill("SW1A 1AA");
  await expect(order.getByText("Estimated delivery", { exact: true })).toBeVisible();
  await expect(notice(order)).toHaveAttribute("datetime", "2026-11-23");
  await expect(order.getByText(today, { exact: true })).toHaveCount(1);
  await expect(status).toHaveCount(0);

  await dispatchAt("2026-11-23T15:30:00Z");
  await page.clock.fastForward(130 * 60_000);
  await expect(notice(order)).toHaveText(tomorrow);
  await expect(order.getByRole("status").filter({ hasText: tomorrow })).toHaveCount(1);
  await page.getByRole("button", { name: "Edit basket" }).click();
  await expect(notice(basket)).toHaveText(tomorrow);
  await page.goto(blade);
  await expect(notice(page.locator("main"))).toHaveText(tomorrow);
});

test("skips a bank holiday and closure, and stays silent for unavailable blades or an inactive calendar", async ({ page }) => {
  const db = await database();
  try {
    await dispatchAt("2026-12-28T13:20:00Z");
    await db.query("update public.delivery_calendars set closures = array_append(closures, '2026-12-29') where calendar = 'warehouse'");
    await page.goto(blade);
    await expect(notice(page.locator("main"))).toHaveText("Dispatches Wednesday 30 December");
  } finally {
    await db.query("update public.delivery_calendars set closures = array_remove(closures, '2026-12-29') where calendar = 'warehouse'");
    await db.end();
  }

  await page.goto("/blades/edg-sum-drg?variant=EDG-SUM-DRG-60");
  await expect(page.getByRole("button", { name: "Add to basket" })).toBeDisabled();
  await expect(notice(page.locator("main"))).toHaveCount(0);

  await dispatchAt("2028-01-03T13:20:00Z");
  await page.goto(blade);
  await expect(page.getByRole("button", { name: "Add to basket" })).toBeEnabled();
  await expect(notice(page.locator("main"))).toHaveCount(0);
  await addBlade(page);
  await expect(notice(selection(page))).toHaveCount(0);
  await selection(page).getByRole("link", { name: "Go to checkout" }).click();
  await expect(summary(page)).toContainText("1 × £22.50");
  await expect(notice(summary(page))).toHaveCount(0);
});
