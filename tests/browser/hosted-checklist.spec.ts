import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function delayHydration(page: Page, path: string, edit: () => Promise<void>) {
  const scripts = Promise.withResolvers<void>();
  await page.route("**/_next/static/**/*.js", async (route) => {
    await scripts.promise;
    await route.continue();
  });
  try {
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.getByRole("button", { name: "Basket 0 blades" })).toBeDisabled();
    await edit();
  } finally {
    scripts.resolve();
  }
  await expect(page.getByRole("button", { name: "Basket 0 blades" })).toBeEnabled();
}

test("keeps pre-hydration enquiry edits through further input, validation and submission", async ({ page }) => {
  const email = `early-enquiry-${randomUUID()}@example.test`;
  const reply = page.getByLabel("Reply email");
  const brand = page.getByLabel("Machine brand");
  const message = page.getByRole("textbox", { name: "Message" });
  await delayHydration(page, "/enquiry?q=EDGEY-HYDRATION-CHECK", async () => {
    await reply.pressSequentially(email);
    await brand.selectOption({ label: "JWEI" });
  });
  await message.fill("Short");
  await expect(reply).toHaveValue(email);
  await expect(brand).toHaveValue("jwei");
  await message.clear();

  const submit = page.getByRole("button", { name: "Send enquiry" });
  await submit.click();
  await expect(page.getByRole("heading", { name: "Check the form" })).toBeFocused();
  await expect(reply).toHaveValue(email);
  await expect(brand).toHaveValue("jwei");
  await message.fill("Can you confirm which holder this blade fits?");
  await submit.click();
  await expect(page.getByRole("heading", { name: "Enquiry received" })).toBeFocused();
});

test("includes pre-hydration Finder edits when a third filter changes", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search by part number, machine or material" });
  const type = page.getByRole("combobox", { name: "Tool type" });
  const machine = page.locator('select[name="machine"]');
  await delayHydration(page, "/blades", async () => {
    await search.pressSequentially("3910301");
    await type.selectOption({ label: "Drag" });
  });
  await machine.selectOption({ index: 1 });
  const selected = await machine.inputValue();
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "3910301" &&
    url.searchParams.get("type") === "drag" && url.searchParams.get("machine") === selected);
  await expect(search).toHaveValue("3910301");
  await expect(type).toHaveValue("drag");
});

test.describe("native form submissions", () => {
  test.use({ javaScriptEnabled: false });

  test("staff sign-in returns the usual form error rather than a 500", async ({ page, baseURL }) => {
    const initial = await page.goto("/admin/sign-in");
    expect(initial?.headers()).toMatchObject({
      "referrer-policy": "same-origin",
      "cache-control": expect.stringContaining("no-store"),
    });
    await page.getByLabel("Work email").fill(`early-staff-${randomUUID()}@example.test`);
    await page.getByLabel("Password").fill("fictional-password");
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/admin/sign-in" && candidate.request().method() === "POST");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const post = await response;
    expect(post.status()).toBe(200);
    expect(await post.request().headerValue("origin")).toBe(baseURL);
    await expect(page.getByRole("alert")).toHaveText("Could not sign in. Check your staff email and password.");
  });

  for (const [path, submit] of [
    ["/enquiry?q=EDGEY-HYDRATION-CHECK", "Send enquiry"],
    ["/account", "Send sign-in link"],
  ] as const) {
    test(`${path} returns a form error rather than a 500`, async ({ page, baseURL }) => {
      await page.goto(path);
      const response = page.waitForResponse((candidate) => candidate.request().method() === "POST");
      await page.getByRole("button", { name: submit, exact: true }).click();
      const post = await response;
      expect(post.status()).toBe(200);
      expect(await post.request().headerValue("origin")).toBe(baseURL);
      await expect(page.getByRole("link", { name: "Enter a valid email address." })).toBeVisible();
    });
  }
});

test("keeps the compact dialog close and checkout action in view", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/blades?q=3910301");
  const card = page.getByRole("link", { name: /EDG-Z10/ }).first();
  await card.click();
  const product = page.getByRole("dialog", { name: /blade/i });
  const close = product.getByRole("button", { name: "Close blade details" });
  const add = product.getByRole("button", { name: "Add to basket" });
  const spec = product.getByRole("link", { name: "Full specification and price breaks" });
  const specs = product.getByRole("region", { name: "Blade specifications and options" });
  await expect(add).toBeEnabled();
  await expect(close).toBeInViewport({ ratio: 1 });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(specs).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => specs.evaluate((region) => region.scrollTop > 0 &&
    region.scrollHeight - region.clientHeight - region.scrollTop <= 1)).toBe(true);
  await expect(spec).toBeInViewport({ ratio: 1 });
  expect(await spec.getByText("breaks", { exact: true }).evaluate((end) => {
    const line = document.createRange();
    line.selectNode(end.firstChild!);
    const word = line.getBoundingClientRect();
    const arrow = end.querySelector("svg")!.getBoundingClientRect();
    return arrow.left >= word.right && arrow.top < word.bottom && arrow.bottom > word.top;
  })).toBe(true);
  await expect(close).toBeInViewport({ ratio: 1 });
  await close.click();
  await expect(card).toBeFocused();
  await card.click();
  await add.click();
  const tray = page.getByRole("dialog", { name: "Your basket" });
  const checkout = tray.getByRole("link", { name: "Go to checkout" });
  const details = tray.getByRole("region", { name: "Basket details" });
  const closeSelection = tray.getByRole("button", { name: "Close basket" });
  await expect(checkout).toBeInViewport({ ratio: 1 });
  await expect(closeSelection).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(details).toBeFocused();
  await page.keyboard.press("End");
  await expect.poll(() => details.evaluate((region) => region.scrollTop)).toBeGreaterThan(0);
  await expect(checkout).toBeInViewport({ ratio: 1 });
  await closeSelection.click();
  await page.getByRole("button", { name: "Basket 1 blade" }).click();
  await expect.poll(() => details.evaluate((region) => region.scrollTop)).toBe(0);
  await checkout.click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole("heading", { name: "Order summary" })).toBeVisible();
});
