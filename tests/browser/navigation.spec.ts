import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { saveThemeBeforeLoad, scanAccessibility, themes } from "../helpers/accessibility";
import { setVerifiedStaffSession } from "./admin-fixtures";

test.use({ trace: "off" });

const menu = (page: Page) => page.locator(".shop-mast summary");
const shopNav = (page: Page) => page.getByRole("navigation", { name: "Shop navigation" });
const staffMenu = (page: Page) => page.locator(".staff-mast summary");
const staffNav = (page: Page) => page.getByRole("navigation", { name: "Staff areas" });
const viewports = [{ width: 1440, height: 940 }, { width: 390, height: 844 }, { width: 320, height: 640 }];

const themeMarker = (page: Page) => page.locator(".mast .theme-track").evaluate((node) => {
  const style = getComputedStyle(node, "::after");
  return { column: style.gridColumnStart, width: style.borderBottomWidth, line: style.borderBottomStyle };
});

async function releaseWithoutClick(page: Page, control: Locator) {
  await control.evaluate((node) => node.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true, once: true }));
  await page.mouse.up();
  await page.mouse.move(0, 200);
}

async function capture(page: Page, filename: string) {
  const directory = process.env.EDGEY_NAV_RENDERS;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: join(directory, filename + ".png"), animations: "disabled" });
  }
}

async function expectUsableMasthead(page: Page, width: number) {
  const controls = await page.locator(".mast .nav-inner").evaluate((row) =>
    Array.from(row.querySelectorAll<HTMLElement>("summary, .mast-leading a, .nav-tools a, .nav-tools button"))
      .filter((control) => control.getClientRects().length > 0)
      .map((control) => ({
        rect: control.getBoundingClientRect().toJSON() as DOMRectJSON,
        border: control.matches("summary") ? null : getComputedStyle(control).borderWidth,
      }))
      .sort((a, b) => a.rect.left - b.rect.left),
  );
  for (const [i, { rect, border }] of controls.entries()) {
    if (border !== null) expect(border).toBe("0px");
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
    if (i) expect(rect.left).toBeGreaterThanOrEqual(controls[i - 1]!.rect.right);
  }
}

type DOMRectJSON = Pick<DOMRect, "width" | "height" | "left" | "right">;

test("shop menu exposes published brands and main journeys from a buyer page", async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("link", { name: "Search blades", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edgey home" })).toHaveAttribute("href", "/");
  await expect(menu(page)).toHaveAccessibleName("Edgey shop menu");
  await expect(page.getByRole("button", { name: /^Basket 0 blades$/ })).toBeEnabled();
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
  await expect(page.getByRole("link", { name: "Search blades", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".fold")).toHaveAttribute("open", "");
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
  await expect(page.getByRole("link", { name: "Search blades", exact: true })).toBeFocused();
  await expect(shopNav(page)).toBeHidden();
  await menu(page).click();
  await page.locator(".fold-backdrop").click({ position: { x: 5, y: 550 } });
  await expect(menu(page)).toBeFocused();
  await expect(shopNav(page)).toBeHidden();
});

test("the proof drifts slowly while the mark and magnifier stay in place", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/contact");
  const mark = menu(page).locator(".mast-mark");
  const outline = mark.locator(".wordmark");
  const wash = mark.locator(".mast-proof-wash");
  await expect(outline).toHaveCSS("animation-name", "none");
  await expect(outline).toHaveCSS("clip-path", "none");
  await expect(wash).toHaveCSS("animation-name", "mast-proof-drift");
  await expect(wash).toHaveCSS("animation-duration", "14s");
  await expect(wash).toHaveCSS("animation-direction", "normal");
  await expect(wash).toHaveCSS("animation-iteration-count", "infinite");
  await expect(wash).toHaveCSS("animation-timing-function", "ease-in-out");
  const driftStart = await wash.evaluate(async (node) => (await node.getAnimations()[0]?.ready)?.startTime);
  expect(driftStart).toEqual(expect.any(Number));
  const bounds = await outline.boundingBox();
  await menu(page).click();
  await expect(outline).toHaveCSS("transform", "none");
  await expect(mark).toHaveCSS("transform", "none");
  expect(await outline.boundingBox()).toEqual(bounds);
  await expect(menu(page).locator(".fold-chevron")).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");
  await expect(page.locator(".fold-inner")).toHaveCSS("animation-duration", "0.14s");
  await expect(page.locator(".fold-panel")).toHaveCSS("opacity", "1");
  await expect(page.locator(".fold-panel")).toHaveCSS("clip-path", "none");
  await menu(page).press("Escape");
  expect(await outline.boundingBox()).toEqual(bounds);
  expect(await wash.evaluate((node) => node.getAnimations()[0]?.startTime)).toBe(driftStart);

  const search = page.getByRole("link", { name: "Search blades", exact: true });
  const icon = search.locator("svg");
  await page.keyboard.press("Shift+Tab");
  await expect(search).toBeFocused();
  await expect(icon).toHaveCSS("opacity", "0.78");
  await expect(icon).toHaveCSS("transform", "none");
  await page.keyboard.press("Shift+Tab");
  await expect(icon).toHaveCSS("opacity", "1");
  await search.hover();
  await expect(icon).toHaveCSS("opacity", "0.78");
  await page.mouse.down();
  await expect(icon).toHaveCSS("opacity", "0.7");
  await expect(icon).toHaveCSS("transform", "none");
  await page.mouse.move(8, 100);
  await page.mouse.up();
});

test("proof colour fades at both ends of the 30% window and leaves plain wire in the rest", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/contact");
  const wash = menu(page).locator(".mast-proof-wash");
  await expect(wash).toHaveCSS("animation-name", "mast-proof-drift");
  const samples = await wash.evaluate(async (node) => {
    const motion = node.getAnimations()[0];
    if (!motion) throw new Error("Proof animation is missing");
    motion.pause();
    await motion.ready;
    return [0, 2100, 2450, 2800, 4200, 5600, 5950, 6300, 10000, 13999, 14000].map((time) => {
      motion.currentTime = time;
      const style = getComputedStyle(node);
      return { opacity: Number(style.opacity), offset: new DOMMatrix(style.transform).e };
    });
  });
  expect(samples.filter((_, index) => index !== 2 && index !== 6).map(({ opacity }) => opacity))
    .toEqual([0, 0, 1, 1, 1, 0, 0, 0, 0]);
  expect(samples[2]!.opacity).toBeCloseTo(.5, 2);
  expect(samples[6]!.opacity).toBeCloseTo(.5, 2);
  expect(samples[3]!.offset).toBeLessThan(samples[4]!.offset);
  expect(samples[4]!.offset).toBeLessThan(samples[5]!.offset);
  expect(samples[10]).toEqual(samples[0]);
});

test("hiding the tab clears an active proof pass and returning starts on plain wire", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/contact");
  const wash = menu(page).locator(".mast-proof-wash");
  const setVisibility = (value: DocumentVisibilityState) => page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  }, value);
  await expect(wash).toHaveCSS("animation-name", "mast-proof-drift");
  await wash.evaluate((node) => {
    const motion = node.getAnimations()[0];
    if (motion) motion.currentTime = 4200;
  });
  await expect(wash).toHaveCSS("opacity", "1");
  await setVisibility("hidden");
  await expect(wash).toHaveCSS("animation-name", "none");
  await expect(wash).toHaveCSS("opacity", "0");
  await setVisibility("visible");
  await expect(wash).toHaveCSS("animation-name", "mast-proof-drift");
  expect(await wash.evaluate((node) => Number(node.getAnimations()[0]?.currentTime))).toBeLessThan(2100);
  await expect(wash).toHaveCSS("opacity", "0");
});

test("the shop menu can pause and resume logo motion across reloads", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/contact");
  const wash = menu(page).locator(".mast-proof-wash");
  await expect(wash).toHaveCSS("animation-name", "mast-proof-drift");
  await menu(page).press("Enter");
  const pause = page.getByRole("checkbox", { name: "Pause logo motion" });
  await expect(pause).not.toBeChecked();
  await wash.evaluate((node) => {
    const motion = node.getAnimations()[0];
    if (motion) motion.currentTime = 4200;
  });
  await expect(wash).toHaveCSS("opacity", "1");
  await pause.press("Space");
  await expect(pause).toBeChecked();
  await expect(wash).toHaveCSS("animation-name", "none");
  await expect(wash).toHaveCSS("opacity", "0");
  await pause.press("Escape");
  await expect(shopNav(page)).toBeHidden();
  await expect(menu(page)).toBeFocused();
  await expect(wash).toHaveCSS("opacity", "0");
  await page.reload();
  await menu(page).press("Enter");
  await expect(pause).toBeChecked();
  await expect(wash).toHaveCSS("animation-name", "none");
  await expect(wash).toHaveCSS("opacity", "0");
  await pause.press("Space");
  await expect(pause).not.toBeChecked();
  await expect(wash).toHaveCSS("animation-name", "mast-proof-drift");
  await expect(wash).toHaveCSS("opacity", "0");
});

test("the theme switch exposes its state and saves a keyboard toggle on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/contact");
  const toggle = page.getByRole("switch", { name: "Light theme", exact: true });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveText("");
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#FAFAF8");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("the active theme icon and wire outline remain distinct in forced colours", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/contact");
  await expect(menu(page).locator(".mast-proof")).toHaveCSS("display", "none");
  await expect(menu(page).locator(".mast-proof-wash")).toHaveCSS("animation-name", "none");
  await expect(menu(page).locator(".mast-proof-wash")).toHaveCSS("opacity", "0");
  await expect(menu(page).locator(".wordmark")).toBeVisible();
  const toggle = page.getByRole("switch", { name: "Light theme", exact: true });
  await expect.poll(() => themeMarker(page)).toEqual({ column: "1", width: "2px", line: "solid" });
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    await toggle.hover();
    await expect(toggle).toHaveCSS("outline-width", "1px");
    await page.mouse.down();
    try {
      await expect(toggle).toHaveCSS("outline-width", "2px");
    } finally {
      await releaseWithoutClick(page, toggle);
    }
  }
  await toggle.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveCSS("outline-style", "solid");
  await expect(toggle).toHaveCSS("outline-width", "2px");
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => themeMarker(page)).toEqual({ column: "2", width: "2px", line: "solid" });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("native menu and public links remain usable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/enquiry");
    await expect(menu(page).locator(".mast-proof-wash")).toHaveCSS("animation-name", "none");
    await expect(menu(page).locator(".mast-proof-wash")).toHaveCSS("opacity", "0");
    await menu(page).press("Enter");
    await expect(shopNav(page)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Pause logo motion" })).toBeHidden();
    await shopNav(page).getByRole("link", { name: "Mimaki" }).click();
    await expect(page.getByRole("heading", { name: "Mimaki blade references" })).toBeVisible();
    await expect(shopNav(page)).toBeHidden();
    await page.getByRole("link", { name: "Search blades", exact: true }).click();
    await expect(page.locator("#finder")).toBeInViewport();
    await page.getByRole("link", { name: "Edgey home", exact: true }).click();
    await expect(page).toHaveURL("/");
  });

  test("the staff mark opens role-appropriate links without JavaScript", async ({ page, baseURL }) => {
    const account = await createLocalAdminUser("warehouse");
    try {
      await setVerifiedStaffSession(page, account, baseURL);
      await page.goto("/admin");
      await expect(staffMenu(page)).toHaveAccessibleName("Edgey staff menu");
      await staffMenu(page).press("Enter");
      await staffNav(page).getByRole("link", { name: "Delivery settings" }).click();
      await expect(page.getByRole("heading", { name: "Delivery settings" })).toBeVisible();
      await expect(staffNav(page)).toBeHidden();
    } finally {
      await localAdminClient().auth.admin.deleteUser(account.id);
    }
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

test("enlarged text and a populated basket keep masthead controls separate across breakpoints", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("edgey-storefront-selection-v1", '{"42e5ce02-4d5e-5c39-9f1b-f76c46c8b386":200}');
  });
  await page.goto("/contact");
  await expect(page.getByRole("button", { name: "Basket 200 blades" })).toBeEnabled();
  for (const size of ["100%", "125%", "200%"]) {
    await page.locator("html").evaluate((element, value) => { element.style.fontSize = value; }, size);
    for (const width of [320, 491, 740, 741, 800, 920, 921]) {
      await page.setViewportSize({ width, height: 640 });
      await test.step(`${width}px at ${size} text`, async () => {
        await expectUsableMasthead(page, width);
      });
    }
  }
});

test("a large basket shows a compact count without hiding the exact total from assistive technology", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => {
    localStorage.setItem("edgey-storefront-selection-v1", '{"42e5ce02-4d5e-5c39-9f1b-f76c46c8b386":1234}');
  });
  await page.goto("/contact");
  const basket = page.getByRole("button", { name: "Basket 1,234 blades", exact: true });
  await expect(basket).toHaveText(/999\+/);
  const icon = await basket.locator(".basket-icon").boundingBox();
  const count = await basket.locator(".tray-count").boundingBox();
  expect(count!.x - (icon!.x + icon!.width)).toBeLessThanOrEqual(6);
  await expectUsableMasthead(page, 320);
  const mark = await menu(page).locator(".mast-mark").boundingBox();
  expect(Math.abs(mark!.x + mark!.width / 2 - 160)).toBeLessThan(9);
  await page.setViewportSize(viewports[0]!);
  const label = await basket.locator(".tray-label").boundingBox();
  const desktopCount = await basket.locator(".tray-count").boundingBox();
  expect(desktopCount!.x - (label!.x + label!.width)).toBeLessThanOrEqual(10);
});

for (const theme of themes) {
  test(`borderless utilities retain hover, press and keyboard focus in ${theme}`, async ({ page }) => {
    await saveThemeBeforeLoad(page, theme);
    const ring = theme === "dark" ? "rgb(155, 227, 249)" : "rgb(33, 93, 173)";
    const idle = "rgba(0, 0, 0, 0)";
    for (const route of ["/contact", "/admin/sign-in"]) {
      await page.setViewportSize(viewports[0]!);
      await page.goto(route);
      const nav = page.locator(".mast .nav-inner");
      const order = nav.locator(".mast-leading a, summary, .nav-tools :is(button, a)");
      const utilities = nav.locator(".mast-leading a, .nav-tools :is(button, a)");
      await expect(utilities).toHaveCount(route === "/contact" ? 4 : 3);
      const canHover = await page.evaluate(() => matchMedia("(hover: hover)").matches);
      for (const control of await utilities.all()) {
        await expect(control).toBeEnabled();
        await expect(control).toHaveCSS("background-color", idle);
        await expect(control).toHaveCSS("outline-style", "none");
        await expect(control).toHaveCSS("box-shadow", "none");
        if (!canHover) continue;
        await control.hover();
        await expect(control).not.toHaveCSS("background-color", idle);
        const hover = await control.evaluate((element) => getComputedStyle(element).backgroundColor);
        await page.mouse.down();
        try {
          await expect(control).not.toHaveCSS("background-color", hover);
          await expect(control).not.toHaveCSS("background-color", idle);
        } finally {
          await releaseWithoutClick(page, control);
        }
      }
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.reload();
        await expect.poll(() => themeMarker(page)).toEqual({ column: theme === "dark" ? "1" : "2", width: "2px", line: "solid" });
        await page.keyboard.press("Tab");
        await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
        for (const control of await order.all()) {
          await page.keyboard.press("Tab");
          await expect(control).toBeFocused();
          await expect(control).toHaveCSS("outline-style", "solid");
          await expect(control).toHaveCSS("outline-width", "2px");
          await expect(control).toHaveCSS("outline-color", ring);
          await expect(control).toHaveCSS("outline-offset", viewport.width < 741 ? "-2px" : "4px");
        }
      }
    }
  });

  test(`shop masthead and open sheet fit the three widths in ${theme}`, async ({ page }) => {
    await saveThemeBeforeLoad(page, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/brands/mimaki");
    await expect(menu(page)).toHaveAttribute("aria-label", "Edgey shop menu");
    await expect(menu(page).locator(".wordmark")).toHaveCSS("animation-name", "none");
    await expect(menu(page).locator(".mast-proof-wash")).toHaveCSS("animation-name", "none");
    await expect(menu(page).locator(".mast-proof-wash")).toHaveCSS("opacity", "0");
    await page.getByRole("link", { name: "Search blades" }).hover();
    await expect(page.locator(".mast-search svg")).toHaveCSS("transform", "none");
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.mouse.move(0, 200);
      await expectUsableMasthead(page, viewport.width);
      const bounds = await menu(page).boundingBox();
      expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThan(9);
      await capture(page, `shop-closed-${theme}-${viewport.width}`);
      await menu(page).click();
      await expect(page.locator(".fold-inner")).toHaveCSS("animation-name", "none");
      await expect(page.getByRole("checkbox", { name: "Pause logo motion" })).toBeHidden();
      await expect(menu(page).locator(".mast-mark")).toHaveCSS("transform", "none");
      const panel = await page.locator(".fold-panel").boundingBox();
      if (viewport.width < 741) expect(panel!.y + panel!.height).toBeCloseTo(viewport.height, 0);
      await capture(page, `shop-menu-${theme}-${viewport.width}`);
      await scanAccessibility(page, theme);
      await page.keyboard.press("Escape");
      await expect(shopNav(page)).toBeHidden();
      await menu(page).blur();
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
      await expect(page.locator(".mast-brand-static .staff-identity")).toHaveText("Staff");
      await expect(page.locator(".mast-proof")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Staff desk", exact: true })).toHaveAttribute("href", "/admin");
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
        await expect(page.getByRole("link", { name: "Search blades", exact: true })).toHaveCount(0);
        await expect(staffMenu(page)).toHaveAttribute("aria-label", "Edgey staff menu");
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          await page.mouse.move(0, 200);
          await expectUsableMasthead(page, viewport.width);
          const mark = await staffMenu(page).boundingBox();
          expect(Math.abs(mark!.x + mark!.width / 2 - viewport.width / 2)).toBeLessThan(9);
          await capture(page, `staff-closed-${theme}-${viewport.width}`);
          await staffMenu(page).click();
          await expect(staffNav(page).getByRole("link", { name: "Delivery settings" })).toHaveAttribute("aria-current", "page");
          await expect(page.getByRole("button", { name: "Sign out" })).toHaveCSS("border-top-width", "1px");
          await capture(page, `staff-menu-${theme}-${viewport.width}`);
          await scanAccessibility(page, theme);
          await page.keyboard.press("Escape");
          await expect(staffNav(page)).toBeHidden();
          await staffMenu(page).blur();
          if (viewport.width === 320) {
            for (const size of ["125%", "200%"]) {
              await page.locator("html").evaluate((element, value) => { element.style.fontSize = value; }, size);
              await expectUsableMasthead(page, viewport.width);
            }
          }
        }
        for (const width of [491, 740, 741, 1440]) {
          await page.setViewportSize({ width, height: 640 });
          for (const size of ["100%", "200%"]) {
            await page.locator("html").evaluate((element, value) => { element.style.fontSize = value; }, size);
            const hitbox = (await staffMenu(page).boundingBox())!;
            const logo = (await staffMenu(page).locator(".mast-mark").boundingBox())!;
            expect(logo.y).toBeGreaterThanOrEqual(hitbox.y);
            expect(logo.y + logo.height).toBeLessThanOrEqual(hitbox.y + hitbox.height);
            await expectUsableMasthead(page, width);
          }
        }
      } finally {
        await localAdminClient().auth.admin.deleteUser(account.id);
      }
    });
  }
});
