import { expect, test } from "@playwright/test";

test("browsing and filtering cards show verified fit and stock without changing the link name", async ({ page }) => {
  const link = page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade", exact: true });
  const card = page.locator(".p-card").filter({ has: link });
  for (const route of ["/", "/blades?machine=zund&material=foamex"]) {
    await page.goto(route);
    await expect(card).toBeVisible();
    await expect(card.getByText("Zünd", { exact: true })).toBeVisible();
    await expect(card.getByText("3910301", { exact: true })).toBeVisible();
    await expect(card.getByText("UCT, SCT", { exact: true })).toBeVisible();
    await expect(card.getByText(/4\.8\smm cutting depth/)).toBeVisible();
    await expect(card.getByText("In stock", { exact: true })).toBeVisible();
    await expect(link).toHaveAccessibleDescription(/Zünd.*3910301.*UCT, SCT.*4\.8\smm cutting depth.*In stock/);
    await expect(card).not.toContainText(/Exact match|Suggested|PRIV-Z10-ALIAS|500-9802/);
  }
});

test("exact results deduplicate tool fit and keep SKU-specific stock separate from family stock", async ({ page }) => {
  await page.goto("/blades?q=EDG-SR6223");
  const roundShank = page.locator(".p-card").filter({
    has: page.getByRole("link", { name: "EDG-SR6223 Round-shank blade", exact: true }),
  });
  await expect(roundShank).toContainText("Exact match · EDG-SR6223");
  await expect(roundShank).toContainText("Adapter: 6 mm for Oscillating");
  expect((await roundShank.innerText()).match(/HF VibraCut, MP HF/g)).toHaveLength(1);

  const summaLink = page.getByRole("link", { name: "EDG-SUM-DRG Summa-pattern drag plotter blade", exact: true });
  const summa = page.locator(".p-card").filter({ has: summaLink });
  await page.goto("/blades");
  await expect(summa).toContainText("Some options out of stock");
  await expect(summaLink).toHaveAttribute("href", "/blades/edg-sum-drg");

  await page.goto("/blades?q=EDG-SUM-DRG-60");
  await expect(summa).toContainText("Exact match · EDG-SUM-DRG-60");
  await expect(summa.getByText("Out of stock", { exact: true })).toBeVisible();
  await expect(summa).toContainText("391-231");
  await expect(summa).not.toContainText("391-360");
  await expect(summaLink).toHaveAttribute("href", "/blades/edg-sum-drg?variant=EDG-SUM-DRG-60");

  const drawing = await summa.locator("img").boundingBox();
  expect(drawing).not.toBeNull();
  await page.mouse.click(drawing!.x + drawing!.width / 2, drawing!.y + drawing!.height / 2);
  await expect(page).toHaveURL(/\/blades\/edg-sum-drg\?variant=EDG-SUM-DRG-60$/);
});

test("brand references align with the site frame and show artwork, verified fit and an honest starting price", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/brands/zund");
  const catalogue = page.getByRole("table", { name: "Published Edgey blades with verified Zünd references" });
  const row = catalogue.getByRole("row").filter({
    has: page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade", exact: true }),
  });
  await expect(row.locator("img")).toHaveAttribute("src", "/line-art/drag-line.svg");
  await expect(row.getByText("3910301", { exact: true })).toBeVisible();
  await expect(row.getByText("UCT, SCT", { exact: true })).toBeVisible();
  await expect(row.getByText("4.8 mm", { exact: true })).toBeVisible();
  await expect(row).toContainText("From £17.50 ex VAT / ea");
  await expect(row).toContainText("£21.00 inc VAT (20%)");
  await expect(row).toContainText("For 10+ blades");
  await expect(row.getByText("In stock", { exact: true })).toBeVisible();
  await expect(catalogue).not.toContainText(/PRIV-Z10-ALIAS|500-9802/);
  const [brandFrame, headerFrame] = await Promise.all([
    page.getByRole("main").boundingBox(),
    page.locator("header.mast > .nav-inner").boundingBox(),
  ]);
  expect(brandFrame?.width).toBeGreaterThan(1000);
  expect(brandFrame?.width).toBe(headerFrame?.width);
  expect(brandFrame?.x).toBe(headerFrame?.x);
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/blades\/edg-z10$/);
});

test("narrow brand rows stack without splitting reference codes and link to the exact configuration", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/brands/summa");
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: /EDG-SUM-DRG-60/ }) });
    await expect(row.getByText("391-231", { exact: true })).toBeVisible();
    await expect(row.getByText("Out of stock", { exact: true })).toBeVisible();
    await expect(row.getByRole("link")).toHaveAttribute("href", "/blades/edg-sum-drg?variant=EDG-SUM-DRG-60");

    const cells = await row.locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(cells[1]).toBeGreaterThan(cells[0]!);
    expect(cells[2]).toBeGreaterThan(cells[1]!);
    expect(await row.locator("code").evaluateAll((codes) => codes.every((code) => {
      const range = document.createRange();
      range.selectNodeContents(code);
      return range.getClientRects().length === 1;
    }))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  }

  await page.goto("/brands/mimaki");
  const rows = page.getByRole("table").getByRole("row").filter({ has: page.getByRole("link", { name: /EDG-MIM-A/ }) });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).not.toContainText("Cutting depth");
});
