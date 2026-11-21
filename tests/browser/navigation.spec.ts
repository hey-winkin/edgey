import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { saveThemeBeforeLoad, scanAccessibility, themes } from "../helpers/accessibility";
import { setVerifiedStaffSession } from "./admin-fixtures";

test.use({ trace: "off" });

const menu = (page: Page) => page.locator(".shop-mast summary");
const shopNav = (page: Page) => page.getByRole("navigation", { name: "Shop navigation" });
const staffMenu = (page: Page) => page.locator(".staff-mast summary");
const staffNav = (page: Page) => page.getByRole("navigation", { name: "Staff areas" });
const viewports = [{ width: 1440, height: 940 }, { width: 390, height: 844 }, { width: 320, height: 640 }];

async function capture(page: Page, filename: string) {
  const directory = process.env.EDGEY_NAV_RENDERS;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, filename + ".png"), animations: "disabled" });
  }
}

async function expectUsableMasthead(page: Page, width: number) {
  const controls = await page.locator(".mast .nav-inner").evaluate((row) =>
    Array.from(row.querySelectorAll<HTMLElement>(".brand, summary, .nav-tools a, .nav-tools button"))
      .filter((control) => control.getClientRects().length > 0)
      .map((control) => control.getBoundingClientRect().toJSON() as DOMRectJSON)
      .sort((a, b) => a.left - b.left),
  );
  for (const [i, rect] of controls.entries()) {
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
    if (i) expect(rect.left).toBeGreaterThanOrEqual(controls[i - 1]!.right);
  }
}

type DOMRectJSON = Pick<DOMRect, "width" | "height" | "left" | "right">;

test("shop menu exposes published brands and main journeys from a buyer page", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("link", { name: "Search blades", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Selection 0 blades$/ })).toBeEnabled();
  await expect(shopNav(page)).toBeHidden();
  await menu(page).click();
  await expect(shopNav(page).getByRole("link", { name: "Contact" })).toHaveAttribute("aria-current", "page");
  const brandLinks = shopNav(page).locator('a[href^="/brands/"]');
  await expect(brandLinks).not.toHaveCount(0);
  const publishedBrands = await brandLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(publishedBrands).toEqual(["/brands/kongsberg", "/brands/mimaki", "/brands/summa", "/brands/zund"]);
  const buyerRoutes = [
    ["By material", "/blades#materials"], ["All blades", "/blades"], ["Trade accounts", "/trade"],
    ["Two-blade trial", "/sample-pack"], ["Match my blade", "/enquiry"], ["Account", "/account"], ["Privacy", "/privacy"],
  ] as const;
  for (const [label, href] of buyerRoutes) {
    await expect(shopNav(page).getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
  }
  await expect(page.getByRole("navigation", { name: "Footer" }).getByRole("link")).toHaveText(["Contact", "Privacy", "Back to top"]);
  await shopNav(page).getByRole("link", { name: "Mimaki" }).click();
  await expect(page.getByRole("heading", { name: "Mimaki blade references" })).toBeVisible();
  await expect(shopNav(page)).toBeHidden();
  await menu(page).click();
  await expect(shopNav(page).getByRole("link", { name: "Mimaki" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Search blades", exact: true }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(shopNav(page)).toBeHidden();
  await menu(page).click();
  await shopNav(page).getByRole("link", { name: "By material" }).click();
  await expect(page).toHaveURL(/\/blades#materials$/);
  await expect(page.getByRole("region", { name: /What are you cutting/i })).toBeInViewport();
  await expect(page.locator("#materials")).toBeFocused();
  await expect(shopNav(page)).toBeHidden();
  await menu(page).click();
  await shopNav(page).getByRole("link", { name: "Search by part number" }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(shopNav(page)).toBeHidden();
  await menu(page).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/blades#materials$/);
  await expect(shopNav(page)).toBeHidden();
});

test("keyboard dismissal keeps focus and navigation does not move the layout", async ({ page }) => {
  await page.goto("/contact");
  const heading = page.getByRole("heading", { level: 1, name: "Contact" });
  const before = await heading.boundingBox();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Edgey home" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(shopNav(page).getByRole("link", { name: "Search by part number" })).toBeFocused();
  expect(await heading.boundingBox()).toEqual(before);
  await page.keyboard.press("/");
  await expect(shopNav(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shopNav(page)).toBeHidden();
  await expect(menu(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Edgey home" })).toBeFocused();
  await expect(shopNav(page)).toBeHidden();
  await menu(page).click();
  await page.locator(".fold-backdrop").click({ position: { x: 5, y: 550 } });
  await expect(menu(page)).toBeFocused();
  await expect(shopNav(page)).toBeHidden();
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("native menu and public links remain usable", async ({ page }) => {
    await page.goto("/enquiry");
    await menu(page).press("Enter");
    await expect(shopNav(page)).toBeVisible();
    await shopNav(page).getByRole("link", { name: "Mimaki" }).click();
    await expect(page.getByRole("heading", { name: "Mimaki blade references" })).toBeVisible();
    await expect(shopNav(page)).toBeHidden();
    await page.getByRole("link", { name: "Search blades", exact: true }).click();
    await expect(page.locator("#finder")).toBeInViewport();
  });
});

test("an unknown shop URL keeps the buyer navigation and returns 404", async ({ page }) => {
  const response = await page.goto("/not-a-shop-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Footer" })).toBeVisible();
  await menu(page).click();
  await expect(shopNav(page).getByRole("link", { name: "All blades" })).toBeVisible();
});

test("enlarged text and a populated selection keep compact controls separate", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => {
    localStorage.setItem("edgey-storefront-selection-v1", '{"42e5ce02-4d5e-5c39-9f1b-f76c46c8b386":200}');
  });
  await page.goto("/contact");
  await expect(page.getByRole("button", { name: "Selection 200 blades" })).toBeEnabled();
  for (const size of ["125%", "200%"]) {
    await page.locator("html").evaluate((element, value) => { element.style.fontSize = value; }, size);
    await expectUsableMasthead(page, 320);
  }
});

for (const theme of themes) {
  test(`shop masthead and open sheet fit the three widths in ${theme}`, async ({ page }) => {
    await saveThemeBeforeLoad(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/brands/mimaki");
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectUsableMasthead(page, viewport.width);
      const bounds = await menu(page).boundingBox();
      expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(9);
      await capture(page, `shop-closed-${theme}-${viewport.width}`);
      await menu(page).click();
      await expect(page.locator(".fold-panel")).toHaveCSS("animation-name", "none");
      const panel = await page.locator(".fold-panel").boundingBox();
      if (viewport.width < 741) expect(panel!.y + panel!.height).toBeCloseTo(viewport.height, 0);
      await capture(page, `shop-menu-${theme}-${viewport.width}`);
      await scanAccessibility(page, theme);
      await page.keyboard.press("Escape");
      await expect(shopNav(page)).toBeHidden();
    }
  });
}

test.describe("staff shell", () => {
  test("sign-in and unknown staff routes never render shop chrome", async ({ page }) => {
    for (const route of ["/admin/sign-in", "/admin/not-a-staff-page"]) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(route.endsWith("sign-in") ? 200 : 404);
      await expect(page.getByRole("banner", { name: "Edgey staff" })).toBeVisible();
      await expect(page.locator(".shop-mast, .site-footer, #selection-trigger")).toHaveCount(0);
      await expect(staffMenu(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "View shop" })).toHaveAttribute("href", "/");
    }
  });

  for (const role of ["warehouse", "finance", "catalogue"] as const) {
    test(`staff menu shows the ${role} destinations with their existing permissions`, async ({ page, baseURL }) => {
      const account = await createLocalAdminUser(role);
      try {
        await setVerifiedStaffSession(page, account, baseURL);
        await page.goto("/admin");
        await expect(page.getByRole("heading", { name: "Staff desk" })).toBeVisible();
        await staffMenu(page).click();
        const areas = ["Staff desk", "Requests", ...(
          role === "warehouse" ? ["Pick and dispatch", "Stock", "Delivery settings", "Sales", "Commercial measures"] :
            role === "finance" ? ["Catalogue", "Sales", "Finance"] : ["Catalogue", "Sales"]
        )];
        await expect(staffNav(page).getByRole("link")).toHaveText(areas);
        await expect(staffNav(page).getByRole("link", { name: "Staff desk" })).toHaveAttribute("aria-current", "page");
        if (role === "warehouse") {
          await staffNav(page).getByRole("link", { name: "Delivery settings" }).click();
          await expect(page.getByRole("heading", { name: "Delivery settings" })).toBeVisible();
          await expect(staffNav(page)).toBeHidden();
          await staffMenu(page).click();
          await expect(staffNav(page)).toBeVisible();
          await staffNav(page).getByRole("link", { name: "Commercial measures" }).click();
          await expect(page.getByRole("heading", { name: "Commercial measures" })).toBeVisible();
          await expect(staffNav(page)).toBeHidden();
          await staffMenu(page).click();
          await expect(staffNav(page).getByRole("link", { name: "Commercial measures" })).toHaveAttribute("aria-current", "page");
          const missing = await page.goto("/admin/not-a-staff-page");
          expect(missing?.status()).toBe(404);
          await expect(page.getByRole("banner", { name: "Edgey staff" })).toBeVisible();
          await expect(page.locator("main")).toHaveCount(1);
          await staffMenu(page).click();
        }
        await page.getByRole("button", { name: "Sign out", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
        await expect(staffMenu(page)).toHaveCount(0);
        await page.getByRole("link", { name: "View shop" }).click();
        await expect(menu(page)).toBeVisible();
      } finally {
        await localAdminClient().auth.admin.deleteUser(account.id);
      }
    });
  }

  for (const theme of themes) {
    test(`staff shell and open sheet fit the three widths in ${theme}`, async ({ page, baseURL }) => {
      const account = await createLocalAdminUser("warehouse");
      try {
        await setVerifiedStaffSession(page, account, baseURL);
        await saveThemeBeforeLoad(page, theme);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/admin/delivery");
        await expect(page.locator(".shop-mast, .site-footer, #selection-trigger")).toHaveCount(0);
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          await expectUsableMasthead(page, viewport.width);
          await capture(page, `staff-closed-${theme}-${viewport.width}`);
          await staffMenu(page).click();
          await expect(staffNav(page).getByRole("link", { name: "Delivery settings" })).toHaveAttribute("aria-current", "page");
          await capture(page, `staff-menu-${theme}-${viewport.width}`);
          await scanAccessibility(page, theme);
          await page.keyboard.press("Escape");
          await expect(staffNav(page)).toBeHidden();
          if (viewport.width === 320) {
            for (const size of ["125%", "200%"]) {
              await page.locator("html").evaluate((element, value) => { element.style.fontSize = value; }, size);
              await expectUsableMasthead(page, viewport.width);
            }
          }
        }
      } finally {
        await localAdminClient().auth.admin.deleteUser(account.id);
      }
    });
  }
});
