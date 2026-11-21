import { expect, test } from "@playwright/test";

test("serves the storefront with the default graphite theme", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Find a blade." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(20, 22, 23)");
});
