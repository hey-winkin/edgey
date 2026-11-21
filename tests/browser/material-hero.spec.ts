import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const preview = "/preview/material-hero";
const corrugated = preview + "?study=corrugated-board";
const hero = (page: Page) => page.locator("section[aria-labelledby='material-hero-title']");

test("the preview uses the homepage shell and public material links without indexing either state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "The cutting room." })).toBeVisible();

  await page.goto(preview + "?study=unknown");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find a blade by material.");
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex, follow");
  await expect(page.getByRole("heading", { level: 2, name: "Blade catalogue" })).toBeVisible();
  const materials = await page.locator("#materials li strong").allTextContents();
  expect(materials).toContain("Corrugated board");
  expect(await hero(page).locator("li strong").allTextContents()).toEqual(materials);

  await hero(page).getByRole("link", { name: /^Vinyl/ }).click();
  await expect(page).toHaveURL(/\/blades\?material=vinyl$/);
  await expect(page.locator(".filter-status")).toContainText("Vinyl");

  await page.goto(corrugated);
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex, follow");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Corrugated board.");
  await expect(hero(page).getByRole("figure")).toContainText("clean slit");
  await expect(hero(page).getByRole("figure").locator("dd")).toHaveText(["26 mm", "7.4 mm", "0.63 mm", "54°", "Oscillating"]);
  await expect(hero(page).getByText("Material thickness range")).toHaveCount(0);
  await expect(hero(page).getByText("Zünd G3, S3, L3")).toBeVisible();
  await expect(hero(page).getByText("EOT, POT, UCT")).toBeVisible();
  await hero(page).getByRole("link", { name: "View blade details" }).click();
  await expect(page).toHaveURL(/\/blades\/edg-z16$/);
  await expect(page.getByRole("heading", { name: "Fit and technical detail" })).toBeVisible();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("keyboard navigation opens the deep link and returns to materials", async ({ page }) => {
    await page.goto(preview + "?material=vinyl");
    const tile = hero(page).getByRole("link", { name: /^Corrugated board/ });
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/material=vinyl&study=corrugated-board#material-hero-title$/);
    await expect(page.getByRole("heading", { level: 1, name: "Corrugated board." })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(hero(page).getByRole("link", { name: "All materials" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\?material=vinyl#material-hero-title$/);
    await expect(page.getByRole("heading", { level: 1, name: "Find a blade by material." })).toBeFocused();
  });
});

for (const width of [320, 390]) {
  for (const theme of ["dark", "light"]) {
    test(`both hero states fit ${width}px in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(preview);
      if (theme === "light") await page.getByRole("button", { name: "Switch to light mode" }).click();

      for (const state of ["tiles", "detail"]) {
        if (state === "detail") await hero(page).getByRole("link", { name: /^Corrugated board/ }).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const options = state === "tiles" ? "Find a blade by material." : "Corrugated board.";
        await expect(hero(page).getByRole("heading", { level: 1, name: options })).toBeInViewport();
        if (state === "detail") {
          const figure = hero(page).getByRole("figure");
          await expect(figure.locator("svg").getByText("A", { exact: true })).toBeVisible();
          await expect(figure.locator("figcaption").getByText("A", { exact: true })).toBeVisible();
        }
        const accessibility = await new AxeBuilder({ page }).include("section[aria-labelledby='material-hero-title']").analyze();
        expect(accessibility.violations).toEqual([]);
      }
    });
  }
}
