import { expect, test } from "@playwright/test";
import { connectAccountDb, createAccountCatalogue } from "../helpers/account-fixture";
import { saveThemeBeforeLoad, scanAccessibility, themes } from "../helpers/accessibility";

const sample = "EDG-Z10\t2\n391 0301,3\nSPB 0030 1\nEDG-SUM-DRG-60 1\nNO-SUCH-PART 4\nEDG-Z46 1";

test("the shop menu and basket both lead to quick order", async ({ page }) => {
  await page.goto("/blades");
  await page.locator("summary[aria-label='Edgey shop menu']").press("Enter");
  await expect(page.getByRole("link", { name: "Quick order" })).toBeVisible();
  await page.getByRole("link", { name: "Quick order" }).press("Enter");
  await expect(page).toHaveURL(/\/quick-order$/);
  await page.goto("/blades");
  await page.getByRole("button", { name: "Basket 0 blades" }).press("Enter");
  await page.getByRole("dialog", { name: "Your basket" }).getByRole("link", { name: "Quick order" }).press("Enter");
  await expect(page).toHaveURL(/\/quick-order$/);
  await expect(page.getByRole("dialog", { name: "Your basket" })).toBeHidden();
});

test("checks maker codes, lets buyers choose and correct, then adds only ready lines", async ({ page }) => {
  await page.goto("/quick-order");
  const input = page.getByRole("textbox", { name: "Part numbers and quantities" });
  await input.fill("EDG-Z10 4");
  await input.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Checked lines" })).toBeFocused();
  const add = page.getByRole("button", { name: "Add ready lines to basket" });
  await add.press("Enter");
  await expect(page.getByText("Added 4 blades to your basket.")).toBeFocused();

  const check = page.getByRole("button", { name: "Check lines", exact: true });
  await input.fill(sample);
  await check.press("Enter");
  const results = page.getByRole("region", { name: "Checked lines" });
  await expect(results.getByText("5–9 blades tier · 9 combined")).toHaveCount(2);
  await expect(results.getByText("£19.95 ex VAT / ea", { exact: false })).toHaveCount(2);
  await expect(results.getByText("Out of stock.", { exact: true })).toBeVisible();
  await expect(results.getByText("No blade matches this part number.")).toHaveCount(2);
  const choice = results.getByRole("combobox", { name: "Choose a blade for line 3" });
  await expect(choice).toHaveValue("");
  await expect(choice.getByRole("option")).toHaveCount(3);
  await choice.press("ArrowDown");
  await expect(add).toBeDisabled();
  await expect(choice).not.toHaveValue("");
  await input.press("Control+End");
  await input.press("Shift+Home");
  await page.keyboard.insertText("EDG-Z10 1");
  await results.getByRole("button", { name: "Check choices" }).press("Enter");
  await expect(results.getByText("10+ blades tier · 10 combined")).toHaveCount(3);
  await expect(results.getByText("£17.50 ex VAT / ea", { exact: false })).toHaveCount(3);
  await add.press("Enter");
  await expect(results.getByText("Added 7 blades to your basket.")).toBeFocused();
  await expect(input).toHaveValue(/EDG-SUM-DRG-60 1\nNO-SUCH-PART 4/);
  await expect(input).not.toHaveValue(/EDG-Z10/);
  await results.getByRole("button", { name: "View basket" }).press("Enter");
  const basket = page.getByRole("dialog", { name: "Your basket" });
  await expect(basket.getByRole("spinbutton", { name: "Quantity for EDG-Z10" })).toHaveValue("10");
  await expect(basket.getByRole("button", { name: /Remove EDG-MIM-A/ })).toBeVisible();
  await expect(basket.getByRole("button", { name: "Remove EDG-SUM-DRG-60" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Basket 11 blades" })).toBeEnabled();
});

test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("native form submission checks lines and accepts a choice", async ({ page }) => {
    await page.goto("/quick-order");
    const input = page.getByRole("textbox", { name: "Part numbers and quantities" });
    await input.fill("3910301,5\nSPB 0030 1");
    await page.getByRole("button", { name: "Check lines" }).press("Enter");
    const results = page.getByRole("region", { name: "Checked lines" });
    await expect(results.getByText("£19.95 ex VAT / ea", { exact: false })).toBeVisible();
    await expect(input).toHaveValue("3910301,5\nSPB 0030 1");
    const choice = results.getByRole("combobox", { name: "Choose a blade for line 2" });
    await choice.selectOption({ index: 1 });
    await results.getByRole("button", { name: "Check choices" }).press("Enter");
    await expect(results.getByText("In stock.", { exact: true })).toHaveCount(2);
    await expect(results.getByText(/Enable JavaScript to add/)).toBeVisible();
    await expect(results.getByRole("button", { name: "Add ready lines to basket" })).toHaveCount(0);
  });
});

test("rechecks publication and stock before adding, without dropping other lines", async ({ page }) => {
  const db = await connectAccountDb();
  let fixture: Awaited<ReturnType<typeof createAccountCatalogue>> | undefined;
  try {
    fixture = await createAccountCatalogue(db);
    await page.goto("/quick-order");
    await page.getByRole("textbox", { name: "Part numbers and quantities" }).fill(
      `${fixture.available.sku} 1\n${fixture.selected.sku} 1\nEDG-Z10 1\nPRIV-Z10-ALIAS 1\nFoamex 1`,
    );
    await page.getByRole("button", { name: "Check lines" }).click();
    const results = page.getByRole("region", { name: "Checked lines" });
    await expect(results.getByText("In stock.", { exact: true })).toHaveCount(3);
    await expect(results.getByText("No blade matches this part number.")).toHaveCount(2);
    await db.query("update public.variants set stock_on_hand = 0 where id = $1", [fixture.available.id]);
    await db.query("update public.variants set publication_status = 'draft' where id = $1", [fixture.selected.id]);
    await results.getByRole("button", { name: "Add ready lines to basket" }).click();
    await expect(results.getByText("Added 1 blade to your basket.")).toBeVisible();
    await expect(results.getByText("Out of stock.", { exact: true })).toBeVisible();
    await expect(results.getByText("The match changed. Check this line again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Basket 1 blade" })).toBeVisible();
  } finally {
    try {
      if (fixture) {
        await db.query("delete from public.stock_movements where variant_id in (select id from public.variants where product_id = $1)", [fixture.productId]);
        await db.query("delete from public.variants where product_id = $1", [fixture.productId]);
        await db.query("delete from public.products where id = $1", [fixture.productId]);
      }
    } finally {
      await db.end();
    }
  }
});

test("bulk add also works with the in-memory basket when local storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get: () => { throw new DOMException("Blocked", "SecurityError"); } });
  });
  await page.goto("/quick-order");
  await page.getByRole("textbox", { name: "Part numbers and quantities" }).fill("EDG-Z10 2\n3910306 1");
  await page.getByRole("button", { name: "Check lines" }).click();
  await page.getByRole("button", { name: "Add ready lines to basket" }).click();
  await expect(page.getByText("Added 3 blades to your basket.")).toBeVisible();
  await page.getByRole("button", { name: "View basket" }).click();
  await page.getByRole("link", { name: "Go to checkout" }).click();
  await expect(page.getByRole("button", { name: "Basket 3 blades" })).toBeVisible();
});

for (const theme of themes) {
  for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 800]] as const) {
    test(`quick order reflows and scans at ${width} × ${height} in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await saveThemeBeforeLoad(page, theme);
      await page.goto("/quick-order");
      await page.getByRole("textbox", { name: "Part numbers and quantities" }).fill(sample);
      await page.getByRole("button", { name: "Check lines" }).click();
      await expect(page.getByRole("heading", { name: "Checked lines" })).toBeFocused();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const main = page.getByRole("main");
      await expect(main.getByRole("combobox")).toBeVisible();
      await expect(main.getByRole("button", { name: "Add ready lines to basket" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await main.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await main.evaluate((element) => element.clientWidth));
      await scanAccessibility(page, theme);
      if (process.env.EDGEY_QUICK_ORDER_RENDER_DIR) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await main.screenshot({ path: `${process.env.EDGEY_QUICK_ORDER_RENDER_DIR}/${width}-${theme}.png` });
      }
    });
  }
}
