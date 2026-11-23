import { expect, test } from "@playwright/test";

const path = "/reference-guide";
const suppressed = /PRIV-Z10-ALIAS|FIXTURE-EDG-Z10|500-9802|5201345|MD300V|EDG-MIM-A30|JWEI and iEcho, 50 mm holders/;

test("lists published blade specifications and filters in place by verified reference, SKU and brand", async ({ page }) => {
  await page.goto(path);
  await expect(page).toHaveTitle("Blade cross-reference guide | Edgey");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Compare tool heads, angles, cutting depths and materials/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  const guide = page.getByRole("main");
  await expect(guide.getByRole("heading", { name: "Blade cross-reference guide", level: 1 })).toBeVisible();
  const zund = guide.getByRole("table", { name: "Zünd", exact: true });
  await expect(zund.getByRole("columnheader", { name: "Tool heads", exact: true })).toBeVisible();
  const z10 = zund.getByRole("row").filter({ has: page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade" }) });
  for (const text of ["Z10", "3910301", "UCT, SCT", "50°", "4.8 mm"]) {
    await expect(z10.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(z10).toContainText("Foamex");

  const search = guide.getByRole("searchbox", { name: "Search the reference guide" });
  await search.focus();
  await search.pressSequentially("391 0301");
  await expect(guide.getByRole("status")).toHaveText("1 entry");
  await expect(z10).toBeVisible();
  await expect(guide.getByRole("table")).toHaveCount(1);
  await expect(search).toBeFocused();
  await expect(page).toHaveURL(/\/reference-guide$/);
  await search.fill("summa edg-sum-drg-60");
  await expect(zund).toHaveCount(0);
  await expect(guide.getByRole("status")).toHaveText("1 entry");
  const variant = guide.getByRole("link", { name: "EDG-SUM-DRG-60 Summa-pattern drag plotter blade" });
  await expect(variant).toHaveAttribute("href", "/blades/edg-sum-drg?variant=EDG-SUM-DRG-60");
  await variant.click();
  await expect(page).toHaveURL(/\/blades\/edg-sum-drg\?variant=EDG-SUM-DRG-60$/);
  await expect(page.getByRole("heading", { name: "Summa-pattern drag plotter blade", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Verified references for EDG-SUM-DRG-60" })).toContainText("391-231");
  await expect(page.getByRole("button", { name: "60° · Out of stock" })).toHaveAttribute("aria-pressed", "true");
});

test("excludes suppressed data from HTML, the RSC response and search", async ({ page, request }) => {
  const response = await page.goto(path);
  expect(await response?.text()).not.toMatch(suppressed);
  const flight = await request.get(path, { headers: { RSC: "1" } });
  expect(flight.ok()).toBe(true);
  expect(flight.headers()["content-type"]).toContain("text/x-component");
  const payload = await flight.text();
  expect(payload).toContain("3910301");
  expect(payload).not.toMatch(suppressed);

  const guide = page.getByRole("main");
  const search = guide.getByRole("searchbox");
  for (const query of ["PRIV-Z10-ALIAS", "500-9802", "MD300V", "JWEI"]) {
    await search.fill(query);
    await expect(guide.getByRole("status")).toHaveText("0 entries");
    await expect(guide).toContainText("No blades match your search");
    await expect(guide.getByRole("table")).toHaveCount(0);
  }
  await search.fill("");
  await expect(guide.getByRole("table", { name: "Zünd" })).toBeVisible();
});

test("stacks labelled fields without horizontal overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(path);
  const guide = page.getByRole("main");
  await guide.getByRole("searchbox").fill("EDG-Z10");
  const row = guide.getByRole("table", { name: "Zünd" }).getByRole("row").filter({
    has: page.getByRole("link", { name: "EDG-Z10 Flat-stock drag blade" }),
  });
  const depth = row.getByRole("cell").filter({ hasText: "4.8 mm" });
  await expect(depth.getByText("Cutting depth", { exact: true })).toBeVisible();
  const cellTops = await row.getByRole("cell").evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().top));
  expect(cellTops).toHaveLength(5);
  expect(cellTops).toEqual([...new Set(cellTops)].sort((a, b) => a - b));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test("prints the current guide in black on white with the source and date but without site chrome", async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    window.print = () => document.documentElement.setAttribute("data-print-requested", "true");
  });
  await page.goto(path);
  const guide = page.getByRole("main");
  await page.emulateMedia({ media: "print" });
  const widths = await guide.getByRole("table").evaluateAll((tables) =>
    tables.map((table) => Array.from(table.querySelectorAll("thead th"), (cell) => cell.getBoundingClientRect().width)));
  expect(widths.length).toBeGreaterThan(1);
  expect(widths.every((columns) => columns.every((width, index) => width === widths[0]?.[index]))).toBe(true);
  await page.emulateMedia({ media: "screen" });
  await guide.getByRole("searchbox").fill("391 231");
  await expect(guide.getByRole("status")).toHaveText("1 entry");
  await guide.getByRole("button", { name: "Print guide" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-requested", "true");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header.shop-mast")).toBeHidden();
  await expect(page.locator("footer.site-footer")).toBeHidden();
  await expect(guide.getByRole("searchbox")).toBeHidden();
  await expect(guide.getByRole("button", { name: "Print guide" })).toBeHidden();
  await expect(guide.getByRole("link", { name: baseURL + path, exact: true })).toBeVisible();
  await expect(guide.locator("time")).toBeVisible();
  await expect(guide.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await expect(guide.getByText("Filtered results. Visit the URL above for the full guide.")).toBeVisible();
  await expect(guide.getByText(/catalogue figures and may come from unverified owner-supplied specifications/)).toBeVisible();
  await expect(guide.getByRole("table", { name: "Summa", exact: true })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(guide.getByRole("heading", { level: 1 })).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(guide.getByRole("table")).toHaveCount(1);
  await expect(guide.getByText("391-231", { exact: true })).toBeVisible();
});

test.describe("reference guide without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("keeps the full guide available with browser Find and Print instructions", async ({ page, baseURL }) => {
    await page.goto(path);
    const guide = page.getByRole("main");
    const instructions = guide.getByText("Use your browser’s Find and Print commands to search or print the full guide.");
    await expect(instructions).toBeVisible();
    await expect(guide.getByRole("searchbox")).toHaveCount(0);
    await expect(guide.getByRole("button", { name: "Print guide" })).toHaveCount(0);
    await expect(guide.getByRole("table", { name: "Zünd", exact: true })).toContainText("3910301");
    await expect(guide.getByRole("table", { name: "Summa", exact: true })).toContainText("391-231");

    await page.emulateMedia({ media: "print" });
    await expect(instructions).toBeHidden();
    await expect(guide.getByRole("link", { name: baseURL + path, exact: true })).toBeVisible();
    await expect(guide.locator("time")).toBeVisible();
    await expect(guide.getByRole("table", { name: "Zünd", exact: true })).toBeVisible();
    await expect(guide.getByRole("table", { name: "Summa", exact: true })).toBeVisible();
  });
});
