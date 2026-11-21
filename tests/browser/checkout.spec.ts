import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { expect, test, type Page } from "@playwright/test";
import { Client } from "pg";

const storageKey = "edgey-storefront-selection-v1";

function selection(page: Page) {
  return page.getByRole("dialog", { name: "Your selection" });
}

async function addZ10(page: Page, quantity: "1" | "5" | "10" = "5") {
  await page.goto("/blades/edg-z10");
  await page.getByRole("button", { name: quantity, exact: true }).click();
  await page.getByRole("button", { name: "Add to selection" }).click();
  await expect(selection(page).getByRole("button", { name: "Remove EDG-Z10" })).toBeVisible();
}

async function fillAddress(page: Page, postcode = "SW1A 1AA") {
  await page.getByLabel("Business name").fill("Example Print Studio");
  await page.getByLabel("Contact email").fill("orders@example.com");
  await page.getByLabel("I’m buying for work").check();
  await page.getByLabel("Recipient name").fill("Alex Morgan");
  await page.getByLabel("Address line 1").fill("10 Sample Street");
  await page.getByLabel("Town or city").fill("London");
  await page.getByLabel("Postcode").fill(postcode);
}

test("a keyboard add opens the selection, which reprices, persists and can be emptied", async ({ page }) => {
  await page.goto("/blades?q=3910301");
  const card = page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade" });
  await card.focus();
  await page.keyboard.press("Enter");
  const product = page.getByRole("dialog", { name: "Flat-stock drag blade" });
  await product.getByRole("button", { name: "5", exact: true }).press("Enter");
  await expect(product).toContainText("£119.70 inc VAT (20%)");
  await product.getByRole("button", { name: "Add to selection" }).press("Enter");
  const tray = selection(page);
  await expect(tray).toBeVisible();
  await expect(product).not.toBeVisible();
  await expect(tray.getByText("Flat-stock drag blade", { exact: true })).toBeVisible();
  await expect(tray.getByText("Dispatch", { exact: true })).toBeVisible();
  await expect(tray.getByText("Estimated delivery", { exact: true })).toHaveCount(0);
  await expect(tray).toContainText("5 × £19.95 = £99.75");
  await expect(tray).toContainText("£50.25 more ex VAT for free delivery");
  await expect(tray).toContainText("£128.04");

  const quantity = tray.getByRole("spinbutton", { name: "Quantity for EDG-Z10" });
  await quantity.fill("0");
  await expect(quantity).toHaveAccessibleDescription("Enter a positive whole quantity.");
  await quantity.fill("9");
  await expect(tray.getByRole("button", { name: "Go to checkout" })).toBeDisabled();
  await quantity.press("Enter");
  await expect(quantity).toBeFocused();
  await expect(tray).toContainText("9 × £19.95 = £179.55");
  await expect(tray).toContainText("Add one blade and save £4.55 ex VAT");
  await quantity.fill("10");
  await tray.getByRole("button", { name: "Update quantity for EDG-Z10" }).click();
  await expect(tray).toContainText("10 × £17.50 = £175.00");

  await page.keyboard.press("Escape");
  const trigger = page.getByRole("button", { name: "Selection 10 blades" });
  await expect(trigger).toBeFocused();
  await page.reload();
  await trigger.click();
  await expect(tray).toContainText("10 × £17.50 = £175.00");
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), storageKey);
  expect(Object.entries(stored)).toEqual([[expect.stringMatching(/^[\da-f-]{36}$/), 10]]);
  await tray.getByRole("button", { name: "Remove EDG-Z10" }).click();
  await expect(tray).toContainText("Your selection is empty.");
  await expect(tray.getByRole("button", { name: "Continue browsing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Selection 0 blades" })).toBeFocused();
});

test("blocked storage leaves the in-memory selection usable across navigation", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new DOMException("Blocked", "SecurityError"); } });
  });
  await addZ10(page, "1");
  await selection(page).getByRole("link", { name: "Go to checkout" }).click();
  await expect(page).toHaveURL("/checkout");
  await expect(page.getByRole("button", { name: "Selection 1 blade" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Order summary" })).toContainText("1 × £22.50 = £22.50");
});

for (const width of [1440, 390]) {
  test(`checkout puts the form first at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await addZ10(page, "1");
    await selection(page).getByRole("link", { name: "Go to checkout" }).click();
    const summary = page.getByRole("region", { name: "Order summary" });
    await expect(summary.getByText("Flat-stock drag blade", { exact: true })).toBeVisible();
    await expect(summary.getByText("Dispatch", { exact: true })).toBeVisible();
    await expect(summary.getByText("Estimated delivery", { exact: true })).toHaveCount(0);
    await expect(summary).toContainText("Delivery and the total are estimates until you enter your postcode.");
    const grid = page.locator(".checkout-grid");
    await expect(grid.locator(":scope > :first-child")).toHaveClass(/checkout-form/);
    const address = await grid.locator("form").boundingBox();
    const order = await summary.boundingBox();
    if (!address || !order) throw new Error("Checkout panels are missing");
    if (width === 1440) expect(address.x + address.width).toBeLessThanOrEqual(order.x);
    else expect(address.y + address.height).toBeLessThanOrEqual(order.y);
  });
}

test("selection changes in another tab update the masthead and preserve both additions", async ({ page, context }) => {
  await addZ10(page);
  await selection(page).getByRole("button", { name: "Continue browsing" }).click();
  const other = await context.newPage();
  await addZ10(other, "1");
  await expect(page.getByRole("button", { name: "Selection 6 blades" })).toBeVisible();
  await page.getByRole("button", { name: "1", exact: true }).click();
  await page.getByRole("button", { name: "Add to selection" }).click();
  await expect(selection(other)).toContainText("7 × £19.95 = £139.65");
});

test("stale selections identify unavailable lines and require acceptance before checkout", async ({ page }) => {
  if (!process.env.SUPABASE_DB_URL) loadEnvFile(".env.local");
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await db.connect();
  let stored: Record<string, number>;
  try {
    const { rows } = await db.query<{ id: string; sku: string }>(
      "select id, sku from public.variants where sku in ('EDG-Z10', 'EDG-Z11', 'EDG-SUM-DRG-60')",
    );
    expect(rows).toHaveLength(3);
    stored = Object.fromEntries(rows.map(({ id, sku }) => [id, sku === "EDG-Z10" ? 41 : 1]));
  } finally {
    await db.end();
  }
  await page.addInitScript(({ key, items }) => localStorage.setItem(key, JSON.stringify(items)), { key: storageKey, items: stored });
  await page.goto("/blades");
  await page.getByRole("button", { name: "Selection 43 blades" }).click();
  const tray = selection(page);
  await expect(tray.getByRole("status")).toContainText(/EDG-Z10: limited stock.*smaller quantity/);
  await expect(tray.getByRole("status")).not.toContainText(/40/);
  await expect(tray.getByRole("status")).toContainText(/EDG-SUM-DRG-60.*out of stock/i);
  await expect(tray.getByRole("status")).toContainText(/unavailable item/i);
  await expect(tray.getByRole("link", { name: "Go to checkout" })).toHaveCount(0);
  await tray.getByRole("button", { name: "Accept changes" }).click();
  await tray.getByRole("link", { name: "Go to checkout" }).click();
  await expect(page.getByRole("region", { name: "Order summary" })).toContainText("10 × £17.50 = £175.00");
  await expect(page.getByRole("button", { name: "Selection 10 blades" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkout");
  const pay = page.getByRole("button", { name: "Continue to payment" });
  const review = page.getByRole("link", { name: "Review changes in your order summary" });
  await expect(pay).toBeDisabled();
  await expect(pay).toHaveAccessibleDescription("Stock has changed. Review changes in your order summary");
  await review.click();
  await expect(page.getByRole("heading", { name: "Order summary" })).toBeFocused();
  await page.getByRole("button", { name: "Accept changes" }).click();
  await expect(review).toHaveCount(0);
  await expect(pay).toBeEnabled();
});

test("checkout validates before payment and retains the same attempt until a material change", async ({ page }) => {
  await addZ10(page);
  await selection(page).getByRole("link", { name: "Go to checkout" }).click();
  const summary = page.getByRole("region", { name: "Order summary" });
  const pay = page.getByRole("button", { name: "Continue to payment" });
  const amount = page.locator(".checkout-amount");
  await expect(summary).toContainText("5 × £19.95 = £99.75");
  await expect(summary).toContainText("£119.70 inc VAT (20%)");

  await pay.click();
  await expect(page.getByLabel("Business name")).toHaveAccessibleDescription("Enter your business name.");
  await expect(page.getByLabel("Business name")).toBeFocused();
  await fillAddress(page, "BT1 5GS");
  const enquiry = page.getByRole("link", { name: "Ask us about delivery" });
  await expect(enquiry).toHaveAttribute("href", "/enquiry?kind=delivery&postcode=BT1%205GS");
  const destination = await page.context().newPage();
  try {
    await destination.goto(await enquiry.getAttribute("href") ?? "");
    await expect(destination.getByRole("heading", { name: "Ask about delivery" })).toBeVisible();
    await expect(destination.getByLabel("Delivery postcode")).toHaveValue("BT1 5GS");
  } finally {
    await destination.close();
  }
  await expect(page.getByLabel("Postcode")).toHaveAccessibleDescription("Online delivery isn’t available for this postcode.");
  await expect(pay).toBeDisabled();
  await expect(amount).toHaveCount(0);

  await page.getByLabel("Postcode").fill("sw1a1aa");
  await expect(summary).toContainText("Next working day");
  await expect(summary.getByText("Estimated delivery", { exact: true })).toBeVisible();
  await expect(summary).toContainText("Dates are provisional until payment.");
  await expect(summary).toContainText("£6.95");
  await expect(summary).toContainText("£21.34");
  await expect(amount).toContainText("£128.04");

  const tokens: string[] = [];
  page.on("request", (request) => {
    const token = request.method() === "POST" && request.postData()?.match(/"attemptToken":"([\da-f-]+)"/)?.[1];
    if (token) tokens.push(token);
  });
  await pay.click();
  const complete = page.getByText(/Card payment is unavailable right now/);
  await expect(complete).toBeVisible();
  await pay.click();
  await expect.poll(() => tokens.length).toBe(2);
  await expect(complete).toBeVisible();
  expect(tokens[1]).toEqual(tokens[0]);
  await page.evaluate(() => Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true }));
  await page.getByLabel("Address line 1").fill("12 Sample Street");
  await expect(complete).toHaveCount(0);
  await pay.click();
  await expect(complete).toBeVisible();
  expect(tokens).toHaveLength(3);
  expect(tokens[2]).not.toEqual(tokens[0]);

  await summary.getByRole("button", { name: "Edit selection" }).click();
  const tray = selection(page);
  const qty = tray.getByRole("spinbutton", { name: "Quantity for EDG-Z10" });
  await qty.fill("10");
  await qty.press("Enter");
  await expect(tray).toContainText("10 × £17.50 = £175.00");
  await tray.getByRole("button", { name: "Return to checkout" }).click();
  await expect(summary.getByRole("button", { name: "Edit selection" })).toBeFocused();
  await expect(amount).toContainText("£210.00");
  await expect(page.getByLabel("Address line 1")).toHaveValue("12 Sample Street");
  await pay.click();
  await expect(complete).toBeVisible();
  expect(tokens).toHaveLength(4);
  expect(tokens[3]).not.toEqual(tokens[2]);

  const storedAttempt = await page.evaluate(() => sessionStorage.getItem("edgey-checkout-attempt-v1"));
  expect(JSON.parse(storedAttempt ?? "{}")).toEqual({ token: tokens[3], quoteKey: expect.any(String), fingerprint: expect.any(String) });
  expect(storedAttempt).not.toMatch(/London|example\.com|Sample Street|SW1A/i);
  await page.reload();
  await fillAddress(page);
  await page.getByLabel("Address line 1").fill("12 Sample Street");
  await expect(summary).toContainText("Next working day");
  await pay.click();
  await expect(complete).toBeVisible();
  expect(tokens).toHaveLength(5);
  expect(tokens[4]).toEqual(tokens[3]);
});

test("a new price must be reviewed and uses a new attempt token", async ({ page }) => {
  if (!process.env.SUPABASE_DB_URL) loadEnvFile(".env.local");
  const db = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await db.connect();
  const sku = "EDG-SUM-TAN-36";
  let price: number | undefined;
  try {
    await page.goto("/blades/edg-sum-tan?variant=" + sku);
    await page.getByRole("button", { name: "Add to selection" }).click();
    await selection(page).getByRole("link", { name: "Go to checkout" }).click();
    await fillAddress(page);
    await expect(page.getByRole("region", { name: "Order summary" })).toContainText("Next working day");
    const tokens: string[] = [];
    page.on("request", (request) => {
      const token = request.method() === "POST" && request.postData()?.match(/"attemptToken":"([\da-f-]+)"/)?.[1];
      if (token) tokens.push(token);
    });
    const pay = page.getByRole("button", { name: "Continue to payment" });
    await pay.click();
    const complete = page.getByText(/Card payment is unavailable right now/);
    await expect(complete).toBeVisible();
    const { rows } = await db.query<{ prior: number }>(
      "update public.variants set price_1_4_pence = price_1_4_pence + 10 where sku = $1 returning price_1_4_pence - 10 as prior",
      [sku],
    );
    price = rows[0]?.prior;
    expect(price).toBeDefined();
    await pay.click();
    await expect(page.getByRole("region", { name: "Order summary" })).toContainText("Your quote has changed.");
    await expect(complete).toHaveCount(0);
    await pay.click();
    await expect(complete).toBeVisible();
    expect(tokens).toHaveLength(3);
    expect(tokens[1]).toEqual(tokens[0]);
    expect(tokens[2]).not.toEqual(tokens[0]);
  } finally {
    if (price !== undefined) await db.query("update public.variants set price_1_4_pence = $1 where sku = $2", [price, sku]);
    await db.end();
  }
});

test("a dropped response does not lose the submitted attempt on reload", async ({ page }) => {
  await addZ10(page);
  await selection(page).getByRole("link", { name: "Go to checkout" }).click();
  await fillAddress(page);
  await expect(page.getByRole("region", { name: "Order summary" })).toContainText("Next working day");
  const checkoutUrl = (url: URL) => url.pathname === "/api/checkout/session";
  let lostToken: string | undefined;
  await page.route(checkoutUrl, async (route) => {
    const request = route.request();
    if (request.method() === "POST") lostToken = request.postData()?.match(/"attemptToken":"([\da-f-]+)"/)?.[1];
    if (lostToken) await route.abort();
    else await route.continue();
  });

  const pay = page.getByRole("button", { name: "Continue to payment" });
  await pay.click();
  await expect(page.getByRole("status").filter({ hasText: "We couldn’t review your checkout." })).toBeVisible();
  expect(lostToken).toBeTruthy();
  await page.unroute(checkoutUrl);
  await page.reload();
  await fillAddress(page);
  await expect(page.getByRole("region", { name: "Order summary" })).toContainText("Next working day");
  const request = page.waitForRequest((request) => request.method() === "POST" && !!request.postData()?.includes("attemptToken"));
  await pay.click();
  expect((await request).postData()).toContain(`"attemptToken":"${lostToken}"`);
  await expect(page.getByText(/Card payment is unavailable right now/)).toBeVisible();
});

test("hands the reviewed order to hosted Checkout and can close the saved attempt on return", async ({ page }) => {
  await addZ10(page);
  await selection(page).getByRole("link", { name: "Go to checkout" }).click();
  await fillAddress(page);
  await expect(page.getByRole("region", { name: "Order summary" })).toContainText("Next working day");
  const sessionId = "cs_test_browserFixture";
  const url = `https://checkout.stripe.com/c/pay/${sessionId}`;
  let attempt: string | undefined;
  await page.route(url, (route) => route.fulfill({ body: "Hosted Checkout fixture" }));
  await page.route("**/api/checkout/session", async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === "close") {
      expect(request.attemptToken).toBe(attempt);
      await route.fulfill({ json: { status: "closed" } });
    } else {
      attempt = request.attemptToken;
      expect(request.lines).toEqual([{ variantId: expect.any(String), quantity: 5 }]);
      expect(request).not.toHaveProperty("totals");
      await route.fulfill({ json: { status: "payment", sessionId, url } });
    }
  });
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByText("Hosted Checkout fixture")).toBeVisible();
  await page.goto("/checkout");
  await expect(page.getByRole("button", { name: "Resume payment" })).toBeVisible();
  await page.getByRole("button", { name: "Close previous checkout" }).click();
  await expect(page.getByText(/The previous checkout is closed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume payment" })).toHaveCount(0);
});

for (const width of [1440, 390, 320]) {
  for (const theme of ["dark", "light"] as const) {
    test(`selection and checkout fit ${width}px in ${theme} with visible keyboard focus`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 1080 : width === 390 ? 844 : 568 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("edgey-theme", value), theme);
      await page.goto("/blades/edg-z16");
      await page.getByRole("button", { name: "Add to selection" }).click();
      await selection(page).getByRole("button", { name: "Continue browsing" }).click();
      await page.goto("/blades?q=3910301");
      await page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade" }).click();
      await page.getByRole("button", { name: "5", exact: true }).click();
      await page.getByRole("button", { name: "Add to selection" }).click();
      const tray = selection(page);
      const checkout = tray.getByRole("link", { name: "Go to checkout" });
      await expect(checkout).toBeVisible();
      await expect(tray.getByRole("listitem")).toHaveCount(2);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await tray.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(await tray.evaluate((el) => el.clientWidth));
      const rootWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
      expect(await rootWidth()).toBe(width);

      const renderDir = process.env.EDGEY_CHECKOUT_RENDER_DIR;
      if (renderDir) {
        await mkdir(renderDir, { recursive: true });
        await page.screenshot({ path: join(renderDir, `selection-${theme}-${width}.png`), animations: "disabled" });
        if (width !== 1440) {
          await checkout.scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(renderDir, `selection-totals-${theme}-${width}.png`), animations: "disabled" });
        }
      }
      await checkout.click();
      if (width === 390 && theme === "dark") {
        const postcode = page.getByLabel("Postcode");
        const summary = page.getByRole("region", { name: "Order summary" });
        await expect(summary).toContainText("£153.84");
        const top = () => postcode.evaluate((input) => input.getBoundingClientRect().top + window.scrollY);
        const originalTop = await top();
        await postcode.fill("SW1");
        expect(await top()).toBe(originalTop);
        await expect(summary).toContainText("£153.84");
        await expect(postcode).not.toHaveAttribute("aria-invalid");
        await postcode.blur();
        await expect(postcode).toHaveAccessibleDescription("Enter a full UK postcode, for example SW1A 1AA.");
      }
      await fillAddress(page);
      await expect(page.getByRole("region", { name: "Order summary" })).toContainText("Next working day");
      expect(await rootWidth()).toBe(width);
      const postcode = page.getByLabel("Postcode");
      await postcode.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(postcode).toBeFocused();
      await expect(postcode).toHaveCSS("outline-color", theme === "dark" ? "rgb(155, 227, 249)" : "rgb(33, 93, 173)");
      if (renderDir) {
        await postcode.blur();
        await page.screenshot({ path: join(renderDir, `checkout-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
      }
    });
  }
}
