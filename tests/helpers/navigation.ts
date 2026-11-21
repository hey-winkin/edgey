import type { Page } from "@playwright/test";

export async function openStaffMenu(page: Page) {
  await page.locator("summary").filter({ hasText: "Staff menu" }).click();
  return page.getByRole("navigation", { name: "Staff areas" });
}

export async function signOutFromStaffMenu(page: Page) {
  await openStaffMenu(page);
  await page.getByRole("banner", { name: "Edgey staff" }).getByRole("button", { name: "Sign out", exact: true }).click();
}

export async function switchTheme(page: Page, theme: "dark" | "light") {
  const toggle = page.getByRole("button", { name: `Switch to ${theme} mode`, exact: true });
  const inMenu = !await toggle.isVisible();
  const menu = page.locator("summary").filter({ hasText: /^Menu$/ });
  if (inMenu) await menu.click();
  await toggle.click();
  if (inMenu) await menu.click();
}
