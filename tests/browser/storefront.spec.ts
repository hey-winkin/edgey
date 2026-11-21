import { expect, test } from "@playwright/test";

test("restores the theme but resets the material proof and view on reload", async ({ page }) => {
  await page.goto("/preview/original-hero");
  const study = page.locator(".study");
  await expect(study).toHaveAttribute("data-mode", "ink");
  await expect(page.getByRole("button", { name: "Prism", exact: true })).toHaveAttribute("aria-pressed", "true");
  const texture = study.locator("#printed-texture");
  for (const [label, key] of [["Coral", "coral"], ["Glacier", "cyan"], ["Citron", "lime"], ["Violet", "violet"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(texture).toHaveAttribute("href", "/proofs/proof-" + key + ".webp");
  }
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await expect(study.locator(".ink-image")).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: "Ink", exact: true }).click();
  await expect(texture).toHaveAttribute("href", "/proofs/proof-violet.webp");
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await page.getByRole("button", { name: "Glacier", exact: true }).click();
  await expect(study).toHaveAttribute("data-mode", "ink");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(texture).toHaveAttribute("href", "/proofs/proof-cyan.webp");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 250, 248)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#FAFAF8");
  await expect(study).toHaveAttribute("data-mode", "ink");
  await expect(texture).toHaveAttribute("href", "/proofs/proof-prism.webp");
});

test("the home keyboard path opens a shareable dialog and returns focus on Escape", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to catalogue" })).toBeFocused();
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox");
  await expect(search).toBeFocused();
  await expect(page.locator(".search-field")).toHaveCSS("outline-color", "rgb(155, 227, 249)");
  await search.fill("3910-301");
  await expect(page.getByRole("status")).toHaveText("1 blade shown.");

  const card = page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade" });
  const cardBody = page.locator(".p-card").filter({ has: card });
  await expect(cardBody).toContainText("Exact match · 3910301");
  await expect(cardBody.locator("img")).toHaveCSS("transition-duration", "0s");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/blades\/edg-z10$/);
  const dialog = page.getByRole("dialog", { name: "Flat-stock drag blade" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "5", exact: true }).click();
  await expect(dialog).toContainText("£99.75");
  await expect(dialog).toContainText("£19.95 each · ex VAT");
  await expect(dialog).toContainText("£119.70 inc VAT (20%)");
  await expect(dialog.getByRole("button", { name: "Add to selection" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\?q=3910-301$/);
  await expect(dialog).not.toBeVisible();
  await expect(card).toBeFocused();
});

test("presents every ambiguous configuration, and a distinct SKU preselects the variant", async ({ page }) => {
  await page.goto("/blades?q=spb%200030");
  const family = page.getByRole("link", { name: /EDG-MIM-45 Mimaki-pattern plotter blade/ });
  const card = page.locator(".p-card").filter({ has: family });
  await expect(card).toContainText("Exact match · SPB-0030");
  await expect(card).toContainText("45° · 1.5 mm diameter or 60° · 1.5 mm diameter");
  await family.click();
  await expect(page).toHaveURL(/\/blades\/edg-mim-45$/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Choose the configuration");
  await expect(dialog.getByRole("button", { name: "45°", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.getByRole("button", { name: "60°", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dialog.getByRole("button", { name: "60°", exact: true }).click();
  await expect(page).toHaveURL(/variant=EDG-MIM-A60$/);
  await expect(dialog.getByRole("button", { name: "60°", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("spb 0030");

  await page.getByRole("searchbox").fill("eDg mIm-A45");
  await expect(card).toContainText("Exact match · EDG-MIM-A45");
  await family.click();
  await expect(page).toHaveURL(/variant=EDG-MIM-A45$/);
  await expect(dialog.getByRole("button", { name: "45°", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a search response does not overwrite newer typing", async ({ page }) => {
  let markRequest!: () => void;
  let releaseRequest!: () => void;
  const seen = new Promise<void>((resolve) => { markRequest = resolve; });
  const release = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route((url) => url.searchParams.get("q") === "Foa", async (route) => {
    markRequest();
    await release;
    await route.continue();
  });

  await page.goto("/blades");
  const search = page.getByRole("searchbox");
  await search.fill("Foa");
  await seen;
  await search.press("m");
  releaseRequest();
  await page.waitForURL((url) => url.searchParams.get("q") === "Foa");
  await expect(search).toHaveValue("Foam");
  await expect(page).toHaveURL(/\?q=Foam$/);
});

test("filters published tool types and materials and carries an unmatched code to the enquiry", async ({ page }) => {
  await page.goto("/blades");
  await expect(page.getByRole("heading", { name: "Blade catalogue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The cutting room." })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Tool type" }).selectOption("kiss-cut");
  await expect(page.getByRole("status")).toHaveText("1 blade shown.");
  await expect(page.getByRole("link", { name: "EDG-Z1 Kiss-cut blade" })).toBeVisible();
  await page.getByRole("link", { name: /Corrugated board.*2 blades/ }).click();
  await expect(page.getByRole("status")).toHaveText("2 blades shown.");
  await expect(page.getByRole("combobox", { name: "Tool type" })).toHaveValue("");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await page.getByRole("searchbox").fill("5201345");
  const ask = page.getByRole("link", { name: "Ask us to match this blade" });
  await expect(ask).toBeVisible();
  await expect(page.getByRole("link", { name: /EDG-Z71/ })).toHaveCount(0);
  await ask.click();
  await expect(page).toHaveURL(/\/enquiry\?q=5201345$/);
  await expect(page.getByRole("textbox", { name: "Your search" })).toHaveValue("5201345");
  await expect(page.getByRole("button", { name: "Send enquiry" })).toBeEnabled();
});

test("direct visits render a standalone verified product with per-blade price breaks", async ({ page, baseURL }) => {
  await page.goto("/blades/edg-z10");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Flat-stock drag blade", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/EDG-Z10.*Zünd Z10/);
  await expect(page.getByText("Zünd Z10 / 3910301")).toBeVisible();
  await expect(page.getByRole("table", { name: "Verified references for EDG-Z10" })).toContainText("G3, S3, L3, D3, PN");
  await expect(page.getByText("In stock", { exact: true })).toBeVisible();
  const breaks = page.getByRole("table", { name: "Price breaks per blade for EDG-Z10" });
  await expect(breaks.getByRole("row", { name: /5–9 blades £19\.95 £23\.94/ })).toBeVisible();
  const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(jsonLd ?? "{}")).toMatchObject({
    "@type": "Product",
    sku: "EDG-Z10",
    url: baseURL + "/blades/edg-z10",
    image: baseURL + "/line-art/drag-line.svg",
    offers: { url: baseURL + "/blades/edg-z10", priceCurrency: "GBP" },
  });
  expect(await page.content()).not.toMatch(/PRIV-Z10-ALIAS|500-9802|FIXTURE-EDG-Z10/);
  const quantity = page.getByRole("spinbutton", { name: "Quantity", exact: true });
  await quantity.fill("0");
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await expect(quantity).toHaveAccessibleDescription("Enter a positive whole quantity to see the total.");
  await quantity.fill("6");
  await expect(page.locator(".detail-total")).toContainText("£119.70 ex VAT");
  await expect(page.locator(".detail-total")).toContainText("£19.95 each · ex VAT");
  await expect(page.locator(".detail-prices")).toContainText("Total for 6 blades");
  await expect(page.locator(".detail-prices")).toContainText("£143.64 inc VAT (20%)");
  await expect(breaks.getByRole("row", { name: /5–9 blades/ })).toHaveAttribute("aria-current", "true");
});

test("out-of-stock options remain inspectable, but are never addable", async ({ page }) => {
  await page.goto("/blades/edg-sum-drg?variant=EDG-SUM-DRG-60");
  const sold = page.getByRole("button", { name: "60° · Out of stock" });
  const add = page.getByRole("button", { name: "Add to selection" });
  await expect(sold).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Out of stock", { exact: true })).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(add).toHaveAccessibleDescription("This variant is out of stock and cannot be added.");
  const disabledFill = await add.evaluate((button) => getComputedStyle(button).backgroundColor);
  await add.hover();
  await expect(add).toHaveCSS("background-color", disabledFill);
  await expect(page.getByText(/removed from your selection/i)).toHaveCount(0);
  await expect(page.locator(".product-panel")).toContainText("Summa 391-231");
  await expect(page.getByRole("table", { name: "Price breaks per blade for EDG-SUM-DRG-60" })).toContainText("£11.95");
  await page.getByRole("button", { name: "5", exact: true }).click();
  await expect(page.locator(".detail-prices")).toContainText("£54.00 inc VAT (20%)");
  await expect(add).toBeDisabled();
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2147483647");
  await expect(page.locator(".detail-total")).toContainText("This quantity exceeds the checkout limit.");
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: "36°", exact: true }).click();
  await expect(add).toBeEnabled();
  await sold.click();
  await expect(add).toBeDisabled();
  await expect(page).toHaveURL(/variant=EDG-SUM-DRG-60$/);
  await expect(page.getByRole("button", { name: "Selection 0 blades" })).toBeVisible();

  await page.goto("/blades");
  await page.getByRole("link", { name: "EDG-SUM-DRG Summa-pattern drag plotter blade" }).click();
  const modal = page.getByRole("dialog", { name: "Summa-pattern drag plotter blade" });
  await modal.getByRole("button", { name: "60° · Out of stock" }).click();
  await expect(modal).toContainText("Summa 391-231");
  await expect(modal.getByRole("group", { name: "Price breaks per blade · ex VAT" })).toContainText("£11.95");
  await expect(modal.getByRole("button", { name: "Add to selection" })).toBeDisabled();
  await expect(modal.getByText(/removed from your selection/i)).toHaveCount(0);
});

test("malformed searches do not crash and an unknown product returns 404", async ({ page }) => {
  expect((await page.goto("/blades?q=%00"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Blade catalogue" })).toBeVisible();
  expect((await page.goto("/?q=52%00%0B01345"))?.status()).toBe(200);
  await expect(page.getByRole("link", { name: /EDG-Z71/ })).toHaveCount(0);
  expect((await page.goto("/blades/no-such-blade"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
});

for (const width of [1440, 390, 320]) {
  for (const theme of ["dark", "light"]) {
    test(`quick view shows the same artwork and all price breaks at ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 390 ? 844 : 640 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((value) => localStorage.setItem("edgey-theme", value), theme);
      await page.goto("/blades/edg-z10");
      const pagePlate = page.locator(".product-artwork .figure-plate");
      const background = await pagePlate.evaluate((plate) => getComputedStyle(plate).backgroundColor);
      const proof = await pagePlate.getAttribute("data-proof");
      const artwork = await pagePlate.locator("img").getAttribute("src");
      expect(artwork).not.toBeNull();
      await page.goto("/blades");
      await page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade" }).click();
      const dialog = page.getByRole("dialog", { name: "Flat-stock drag blade" });
      const plate = dialog.locator(".figure-plate");
      await expect(plate.locator("img")).toHaveAttribute("src", artwork!);
      await expect(plate).toHaveCSS("background-color", background);
      await expect(plate).toHaveAttribute("data-proof", proof!);
      await expect(dialog.getByRole("link", { name: "View photograph" })).toHaveAttribute("href", "/photos/drag.webp");
      await expect(dialog.getByRole("button", { name: "Add to selection" })).toBeEnabled();
      await expect(dialog.getByRole("button", { name: "Close blade details" })).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByRole("link", { name: "Full specification and price breaks" })).toBeInViewport({ ratio: 1 });
      const tiers = dialog.getByRole("group", { name: "Price breaks per blade · ex VAT" });
      if (width < 1440) await tiers.scrollIntoViewIfNeeded();
      await expect(tiers).toBeInViewport({ ratio: 1 });
      await expect(tiers).toContainText(/5–9 blades\s*£19\.95/);
      await expect(tiers).toContainText(/10\+ blades\s*£17\.50/);
      const five = dialog.getByRole("button", { name: "5", exact: true });
      await five.click();
      await expect(five).toHaveAttribute("aria-pressed", "true");
      await expect(five).toHaveCSS("background-image", "none");
      await expect(dialog.locator(".detail-prices")).toContainText("£119.70 inc VAT (20%)");
      expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    });
  }
}

for (const width of [390, 320]) {
  test(`the home, catalogue and product fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
    for (const route of ["/", "/preview/original-hero", "/blades", "/blades/edg-z10", "/blades/edg-mim-45?variant=EDG-MIM-A45", "/enquiry?q=5201345"]) {
      await page.goto(route);
      const overflows = () =>
        page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(await overflows()).toBe(false);
      if (route === "/preview/original-hero") {
        const key = page.locator(".layer-key");
        await expect(key).toBeVisible();
        await expect(key).toHaveText("Print face / Fluted core / Back liner");
        await expect(page.getByRole("button", { name: "Glacier", exact: true })).toBeVisible();
      }
      if (route === "/" || route === "/preview/original-hero") {
        await expect(page.locator(".cards")).toHaveCSS("grid-template-columns", /^\d+px \d+px$/);
      }
      if (route.startsWith("/blades/")) await expect(page.locator(".detail-total")).toBeInViewport({ ratio: 1 });
    }
  });
}
