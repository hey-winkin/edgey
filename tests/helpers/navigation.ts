import { expect, type Page } from "@playwright/test";

export async function openStaffMenu(page: Page) {
  await page.locator('summary[aria-label="Edgey staff menu"]').click();
  return page.getByRole("navigation", { name: "Staff areas" });
}

export async function signOutFromStaffMenu(page: Page) {
  await openStaffMenu(page);
  await page.getByRole("banner", { name: "Edgey staff" }).getByRole("button", { name: "Sign out", exact: true }).click();
}

export async function switchTheme(page: Page, theme: "dark" | "light") {
  const toggle = page.getByRole("switch", { name: "Light theme" });
  const enabled = String(theme === "light");
  if (await page.locator("html").getAttribute("data-theme") !== theme) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", enabled);
}
