import { expect, test } from "@playwright/test";
import { saveThemeBeforeLoad, themes } from "../helpers/accessibility";

const materials = [
  { name: "Corrugated board", slug: "corrugated-board", sku: "EDG-Z16", href: "/blades/edg-z16", count: 2, fit: "EOT, POT, UCT" },
  { name: "Vinyl", slug: "vinyl", sku: "EDG-MIM-A45", href: "/blades/edg-mim-45?variant=EDG-MIM-A45", count: 5, fit: "CG-SRIII" },
  { name: "Correx", slug: "correx", sku: "EDG-SR6223", href: "/blades/edg-sr6223", count: 3, fit: "6 mm for Oscillating" },
  { name: "Foamex", slug: "foamex", sku: "EDG-Z10", href: "/blades/edg-z10", count: 2, fit: "UCT, SCT" },
  { name: "Textile", slug: "textile", sku: "EDG-Z50", href: "/blades/edg-z50", count: 1, fit: "DRT, PRT" },
] as const;

const additional = [
  ["Banner", "banner", "EDG-Z10", "/blades/edg-z10", "UCT, SCT"],
  ["Flock", "flock", "EDG-SUM-DRG-60", "/blades/edg-sum-drg?variant=EDG-SUM-DRG-60", "D-Series Drag; F-Series Drag Module"],
  ["Foam board", "foam-board", "EDG-Z16", "/blades/edg-z16", "EOT, POT, UCT"],
  ["Honeycomb board", "honeycomb-board", "EDG-Z71", "/blades/edg-z71", "VCT V-Cut Tool"],
  ["Laminate", "laminate", "EDG-SUM-DRG-60", "/blades/edg-sum-drg?variant=EDG-SUM-DRG-60", "D-Series Drag; F-Series Drag Module"],
  ["PVC", "pvc", "EDG-Z10", "/blades/edg-z10", "UCT, SCT"],
  ["Re-board", "re-board", "EDG-Z71", "/blades/edg-z71", "VCT V-Cut Tool"],
  ["Reflective film", "reflective-film", "EDG-MIM-A60", "/blades/edg-mim-45?variant=EDG-MIM-A60", "CG-SRIII"],
  ["Soft signage", "soft-signage", "EDG-Z50", "/blades/edg-z50", "DRT, PRT"],
] as const;

const stagedFamilyCodes = /^EDG-(?:Z10|Z16|SR6223|Z50|Z71|Z1|SUM-DRG|SUM-TAN|MIM-45)\s/;

test("the homepage showcases corrugated by default without filtering the first catalogue view", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByRole("region", { name: "Find a blade." });
  const study = hero.getByRole("region", { name: "Corrugated board" });
  await expect(study).toContainText("EDG-Z16");
  await expect(study).toContainText("Zünd G3, S3, L3");
  await expect(hero.getByText(/blade quality|owner will supply/i)).toHaveCount(0);
  await expect(hero.getByRole("link", { name: "Corrugated board", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#catalogue").getByRole("link", { name: stagedFamilyCodes })).toHaveCount(9);
  await expect(page.locator(".mat-list")).toHaveCount(0);
  await hero.getByRole("link", { name: "See 2 blades for Corrugated board" }).click();
  await expect(page).toHaveURL(/\?material=corrugated-board#catalogue$/);
  await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Blade catalogue" })).toBeInViewport();
});

test("an illustrated material link selects the featured variant and filters the same catalogue", async ({ page }) => {
  await page.goto("/?q=3910301&type=drag&machine=zund");
  const tabs = page.getByRole("navigation", { name: "Browse by material" });
  for (const { name, slug, sku, href, count, fit } of materials) {
    const tab = tabs.getByRole("link", { name, exact: true });
    await tab.focus();
    await tab.press("Enter");
    const study = page.getByRole("region", { name, exact: true });
    await expect(page).toHaveURL("/?material=" + slug);
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute("aria-current", "true");
    await expect(tabs.locator("[aria-current]")).toHaveCount(1);
    await expect(tabs.locator('a[href^="/?material="] svg')).toHaveCount(5);
    await expect(study.locator("figure svg")).toHaveCount(1);
    await expect(study).toContainText(sku);
    await expect(study).toContainText(fit);
    await expect(study.getByRole("link", { name: "View blade details" })).toHaveAttribute("href", href);
    if (slug === "vinyl") await expect(study).toContainText("Shared OEM reference: Mimaki SPB-0030. Check the blade configuration before ordering.");
    await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(count);
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(page.getByLabel("Tool type")).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Machine", exact: true })).toHaveValue("");
  }
  await page.reload();
  await expect(tabs.getByRole("link", { name: "Textile" })).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(1);
  await page.goBack();
  await expect(tabs.getByRole("link", { name: "Foamex" })).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(2);
});

test("the homepage finder uses the catalogue for OEM, SKU, machine and blade-name lookups", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "Search blades" });
  const cards = page.locator("#catalogue .cards");
  for (const [query, card] of [
    ["3910301", "EDG-Z10"],
    ["EDG-MIM-A45", "EDG-MIM-45"],
    ["Zünd G3", "EDG-Z16"],
    ["CJV150", "EDG-MIM-45"],
    ["Flat-stock drag blade", "EDG-Z10"],
  ] as const) {
    await search.fill(query);
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === query);
    await expect(cards).toContainText(card);
    await expect(page.getByRole("link", { name: /found · View results/ })).toBeVisible();
  }
  await search.press("Enter");
  await expect(page).toHaveURL(/#catalogue$/);
  await expect(page.locator("#catalogue")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Blade catalogue" })).toBeInViewport();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(cards.getByRole("link", { name: stagedFamilyCodes })).toHaveCount(9);

  const toolType = page.getByRole("combobox", { name: "Tool type" });
  await toolType.focus();
  await toolType.selectOption("rotary");
  await expect(page).toHaveURL((url) => url.searchParams.get("type") === "rotary");
  await expect(toolType).toBeFocused();
  await expect(cards.locator(".p-card")).toHaveCount(1);
  await expect(cards).toContainText("EDG-Z50");
});

test("the finder exposes active filters and can retry the same search across the full catalogue", async ({ page }) => {
  await page.goto("/?material=textile");
  await expect(page.getByText("Searching within: Textile.")).toBeVisible();
  const search = page.getByRole("searchbox");
  await search.fill("3910306");
  await expect(page.getByRole("link", { name: "No match · Ask us" })).toHaveAttribute("href", "/enquiry?q=3910306");
  await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(0);
  await page.getByRole("link", { name: "Search all blades" }).click();
  await expect(page).toHaveURL("/?q=3910306");
  await expect(search).toHaveValue("3910306");
  await expect(page.locator("#catalogue .cards")).toContainText("Exact match · 3910306");
});

test("draft-only and unknown material links don't select an unrelated study", async ({ page }) => {
  for (const [slug, emptyCopy, count] of [
    ["display-board", "No cutting study for this material.", 0],
    ["not-a-substrate", "No cutting study for this material.", 0],
  ] as const) {
    await page.goto("/?material=" + slug);
    await expect(page.getByText(emptyCopy, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Browse by material" }).locator("[aria-current]")).toHaveCount(0);
    await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(count);
  }
});

test("the compact disclosure exposes every additional published study without adding a wall of tiles", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  const chooser = page.getByRole("navigation", { name: "Browse by material" });
  const more = chooser.locator("summary");
  await expect(more).toHaveText("More studies (9)");
  await expect(chooser.getByRole("link")).toHaveCount(6);
  await more.focus();
  await more.press("Space");
  await expect(chooser.locator("details[open]").getByRole("link")).toHaveText(additional.map(([name]) => name));
  for (const [name, slug, sku, href, fit] of additional) {
    const link = chooser.getByRole("link", { name, exact: true });
    await link.focus();
    await link.press("Enter");
    await expect(page).toHaveURL("/?material=" + slug);
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute("aria-current", "true");
    const study = page.getByRole("region", { name, exact: true });
    await expect(study).toContainText(sku);
    await expect(study).toContainText(fit);
    await expect(study.locator("figure svg")).toHaveCount(1);
    await expect(study.getByRole("link", { name: "View blade details" })).toHaveAttribute("href", href);
    await expect(study.getByRole("link", { name: /See [1-9]/ })).toHaveAttribute("href", "/?material=" + slug + "#catalogue");
    await expect(page.getByText(`Searching within: ${name}.`)).toBeVisible();
    await expect(page.locator(`#catalogue .p-card a[href="${href.split("?")[0]}"]`)).toBeVisible();
    if (slug === "reflective-film") {
      await expect(study.getByText("Cutting depth", { exact: true })).toHaveCount(0);
      await expect(study.getByText("Tool heads", { exact: true })).toHaveCount(0);
      await expect(study).toContainText("Shared OEM reference: Mimaki SPB-0030.");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  }
  await page.reload();
  await expect(more).toContainText("Soft signage");
  await expect(more).toHaveAccessibleName("More studies (9). Current study: Soft signage");
  await expect(page.getByRole("region", { name: "Soft signage" })).toContainText("Bore diameter");
});

test("jumping to the same material's results keeps its search scope", async ({ page }) => {
  await page.goto("/?material=textile");
  await page.getByRole("link", { name: "See 1 blade for Textile" }).click();
  await expect(page).toHaveURL("/?material=textile#catalogue");
  const search = page.getByRole("searchbox");
  await search.fill("3910306");
  await expect(page).toHaveURL((url) =>
    url.searchParams.get("q") === "3910306" && url.searchParams.get("material") === "textile",
  );
  await expect(page.getByRole("link", { name: "No match · Ask us" })).toBeVisible();
  await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(0);
});

test("selecting a material takes precedence over an in-flight search", async ({ page }) => {
  let markRequest!: () => void;
  let releaseRequest!: () => void;
  const seen = new Promise<void>((resolve) => { markRequest = resolve; });
  const release = new Promise<void>((resolve) => { releaseRequest = resolve; });
  await page.route((url) => url.searchParams.get("q") === "3910301", async (route) => {
    markRequest();
    await release;
    await route.continue();
  });
  await page.goto("/");
  const search = page.getByRole("searchbox");
  await search.fill("3910301");
  await seen;
  try {
    await page.getByRole("link", { name: "Textile", exact: true }).click();
    await expect(page).toHaveURL("/?material=textile");
  } finally {
    releaseRequest();
  }
  await expect(search).toHaveValue("");
  await expect(page.locator("#catalogue .cards")).toContainText("EDG-Z50");
  await expect(page.locator("#catalogue .cards")).not.toContainText("EDG-Z10");
});

test("machine buttons, the one full materials directory and the original preview have working destinations", async ({ page }) => {
  await page.goto("/");
  const brands = page.getByRole("navigation", { name: "Browse by machine" });
  const machineLinks = await brands.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(machineLinks.sort()).toEqual(["/brands/kongsberg", "/brands/mimaki", "/brands/summa", "/brands/zund"]);
  await brands.getByRole("link", { name: "Zünd" }).click();
  await expect(page).toHaveURL("/brands/zund");
  await expect(page.getByRole("heading", { level: 1, name: /Zünd/ })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "All materials" }).click();
  await expect(page).toHaveURL("/blades#materials");
  await expect(page.locator(".mat-list > li")).toHaveCount(14);
  await page.goto("/preview/original-hero");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByRole("heading", { level: 1, name: "The cutting room." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Prism" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Find a blade" }).click();
  await expect(page.getByRole("searchbox")).toBeFocused();
});

test("the search form and material selection remain usable without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("searchbox").fill("3910301");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("#catalogue .cards")).toContainText("Exact match · 3910301");
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === "3910301" && url.hash === "#catalogue");
    await page.getByRole("link", { name: "Vinyl", exact: true }).click();
    await expect(page.getByRole("region", { name: "Vinyl" })).toContainText("EDG-MIM-A45");
    await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(5);
    await page.locator("summary").filter({ hasText: "More studies" }).click();
    await page.getByRole("link", { name: "Foam board", exact: true }).click();
    await expect(page.getByRole("region", { name: "Foam board" })).toContainText("EDG-Z16");
    await expect(page.locator("#catalogue .cards .p-card")).toHaveCount(1);
  } finally {
    await context.close();
  }
});

for (const theme of themes) {
  for (const width of [1440, 1280, 390, 320]) {
    test(`${theme} at ${width}px shows search, machines, material tabs and legible study callouts`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 900 });
      await saveThemeBeforeLoad(page, theme);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const search = await page.getByRole("searchbox").boundingBox();
      const machines = await page.getByRole("navigation", { name: "Browse by machine" }).boundingBox();
      const tabs = await page.getByRole("navigation", { name: "Browse by material" }).boundingBox();
      const study = page.getByRole("region", { name: "Corrugated board" });
      const plate = await study.boundingBox();
      expect(search!.y + search!.height).toBeLessThan(machines!.y);
      expect(machines!.y + machines!.height).toBeLessThan(tabs!.y);
      if (width >= 1280) expect(plate!.x).toBeGreaterThan(tabs!.x + tabs!.width);
      else expect(plate!.y).toBeGreaterThan(tabs!.y + tabs!.height);
      await expect(study.locator("dt").filter({ hasText: "Blade length" })).toBeVisible();
      await expect(study.locator("dt span").first()).toHaveCSS("display", width >= 1280 ? "none" : "inline-grid");
      await expect(study.locator("figure svg text").filter({ hasText: width >= 1280 ? /^Blade length/ : /^A$/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }
}
