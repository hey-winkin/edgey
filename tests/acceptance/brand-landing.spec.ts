import { expect, test } from "@playwright/test";

test("verified references link to a brand page, while brands without public fit return 404", async ({ page, request, baseURL }) => {
  await page.goto("/blades/edg-mim-45");
  const references = page.getByRole("table", { name: "Verified references for EDG-MIM-A45" });
  await expect(references.getByRole("link", { name: "Mimaki", exact: true })).toHaveAttribute("href", "/brands/mimaki");
  await references.getByRole("link", { name: "Mimaki", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mimaki blade references" })).toBeVisible();

  const table = page.getByRole("table");
  await expect(table.getByRole("row").filter({ hasText: /EDG-MIM-A45/ })).toContainText("SPB-0030");
  await expect(table.getByRole("row").filter({ hasText: /EDG-MIM-A60/ })).toContainText("SPB-0030");
  await expect(table.getByRole("link", { name: /EDG-MIM-A60/ })).toHaveAttribute("href", "/blades/edg-mim-45?variant=EDG-MIM-A60");
  await expect(table).not.toContainText("EDG-MIM-A30");
  await page.screenshot({ path: test.info().outputPath("brand-landing.png"), fullPage: true });

  expect((await request.get("/brands/mimaki")).status()).toBe(200);
  expect((await request.get("/brands/graphtec")).status()).toBe(404);
  expect((await request.get("/brands/not-a-catalogue-brand")).status()).toBe(404);
  const zund = await request.get("/brands/zund");
  expect(zund.status()).toBe(200);
  expect(await zund.text()).not.toMatch(/PRIV-Z10-ALIAS|500-9802/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`<loc>${baseURL}/brands/mimaki</loc>`);
  expect(sitemap).toContain(`<loc>${baseURL}/reference-guide</loc>`);
  expect(sitemap).not.toContain("/brands/graphtec");

  await page.getByRole("link", { name: "Browse the printable cross-reference guide" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Blade cross-reference guide" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/reference-guide`);
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
});
