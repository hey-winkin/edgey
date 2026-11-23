import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { extractText } from "unpdf";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb, createAccountCatalogue } from "../helpers/account-fixture";
import { scanBothThemes } from "../helpers/accessibility";
import { switchTheme } from "../helpers/navigation";
import { setVerifiedStaffSession } from "./admin-fixtures";

const orders = "/admin/purchase-orders";
const screenshotDir = process.env.EDGEY_PURCHASE_SCREENSHOTS;
async function capture(page: Page, name: string) {
  if (!screenshotDir) return;
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.screenshot({ path: join(screenshotDir, name + ".png"), fullPage: true });
}
const heading = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });

test.use({ locale: "en-GB", actionTimeout: 10_000 });

test("stock ordering is available to warehouse staff who can manage purchase orders", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const db = await connectAccountDb();
  const staff = await createLocalAdminUser("warehouse");
  let fixture: Awaited<ReturnType<typeof createAccountCatalogue>> | undefined;
  try {
    fixture = await createAccountCatalogue(db);
    const { soldOut: { id, sku, label } } = fixture;
    const stockPath = "/admin/stock?view=out-of-stock";
    const newOrderPath = orders + "/new";
    const bladeOrderPath = `${newOrderPath}?variant=${id}`;
    const topAction = page.getByRole("link", { name: "Order stock", exact: true });
    const stockRow = page.getByRole("table", { name: "Variant balances" }).getByRole("row")
      .filter({ has: page.getByRole("link", { name: sku, exact: true }) });
    const bladeAction = stockRow.getByRole("link", { name: `Order stock for ${sku}`, exact: true });
    const selected = page.getByRole("list", { name: "Selected products", exact: true }).getByRole("listitem");

    await setVerifiedStaffSession(page, staff, baseURL);
    await page.goto(stockPath);
    await expect(heading(page, "Out of stock")).toBeVisible();
    await expect(page).toHaveTitle("Out of stock | Edgey");
    await expect(stockRow).toBeVisible();
    await expect(page.getByRole("link", { name: /^Order stock(?: for .+)?$/ })).toHaveCount(0);
    await page.goto(bladeOrderPath);
    await expect(page).toHaveURL("/admin");

    for (const role of ["catalogue", "finance"] as const) {
      await test.step(`warehouse with ${role}`, async () => {
        await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [staff.id, role]);
        await page.goto(stockPath);
        await expect(topAction).toHaveAttribute("href", newOrderPath);
        await expect(topAction).toHaveClass(/\bprimary\b/);
        await expect(bladeAction).toHaveText("Order stock");
        await expect(bladeAction).toHaveAttribute("href", bladeOrderPath);
        if (role === "catalogue") {
          const viewport = page.viewportSize()!;
          await capture(page, "order-stock-levels");
          await page.setViewportSize({ width: 320, height: 740 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
          await bladeAction.scrollIntoViewIfNeeded();
          await expect(bladeAction).toBeInViewport();
          const bounds = await bladeAction.boundingBox();
          expect(bounds?.height).toBeGreaterThanOrEqual(44);
          await scanBothThemes(page);
          await capture(page, "order-stock-levels-320");
          await page.setViewportSize(viewport);
        }

        await topAction.click();
        await expect(page).toHaveURL(newOrderPath);
        await expect(heading(page, "New purchase order")).toBeVisible();
        await expect(page.getByText("No lines yet. Use the catalogue above to add the first product.")).toBeVisible();
        await expect(selected).toHaveCount(0);

        await page.goto(stockPath);
        await bladeAction.click();
        await expect(page).toHaveURL(bladeOrderPath);
        await expect(heading(page, "New purchase order")).toBeVisible();
        await expect(page).toHaveTitle("New purchase order | Edgey");
        await expect(selected).toHaveCount(1);
        await expect(selected).toContainText(sku);
        await expect(selected).toContainText(label);

        await page.goto("/admin/stock");
        await expect(heading(page, "Stock levels")).toBeVisible();
        await expect(page.getByRole("link", { name: /^Order stock(?: for .+)?$/ })).toHaveCount(0);
        await db.query("delete from public.staff_members where user_id = $1 and role = $2", [staff.id, role]);
      });
    }
  } finally {
    try {
      if (fixture) {
        await db.query("delete from public.stock_movements where variant_id in (select id from public.variants where product_id = $1)", [fixture.productId]);
        await db.query("delete from public.variants where product_id = $1", [fixture.productId]);
        await db.query("delete from public.products where id = $1", [fixture.productId]);
      }
    } finally {
      await db.end();
      await localAdminClient().auth.admin.deleteUser(staff.id);
    }
  }
});

test("a draft started before hydration can be saved by native form submission", async ({ page, baseURL }) => {
  const sql = await connectAccountDb();
  const staff = await createLocalAdminUser("catalogue");
  let orderId: string | undefined;
  try {
    await setVerifiedStaffSession(page, staff, baseURL);
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, (route) => route.abort());
    const { rows } = await sql.query("select id from public.variants where sku='EDG-Z10'");
    await page.goto(`${orders}/new?variant=${rows[0].id}`);
    orderId = await page.locator('input[name="order_id"]').inputValue();
    const line = page.getByRole("list", { name: "Selected products" });
    await line.getByLabel("Quantity").fill("3");
    await line.getByLabel("Unit price ex VAT (order currency)").fill("23.57");
    await page.getByLabel("Order date").fill("2026-11-20");
    await page.getByText("Charges and order note", { exact: true }).click();
    await page.getByLabel("Order note (optional)").fill("Fictional note entered without hydration.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(orders + "/" + orderId);
    await expect(page.getByText("Fictional note entered without hydration.")).toBeVisible();
    const posted = await sql.query(`
      select l.sku, l.quantity, c.unit_price_minor, o.ordered_on::text
        from public.staff_purchase_orders o
        join public.staff_purchase_order_lines l on l.purchase_order_id=o.id
        join public.staff_purchase_order_line_costs c using (purchase_order_id,variant_id)
       where o.id=$1`, [orderId]);
    expect(posted.rows).toEqual([{ sku: "EDG-Z10", quantity: 3, unit_price_minor: 2357, ordered_on: "2026-11-20" }]);
  } finally {
    if (orderId) {
      await sql.query("delete from public.staff_purchase_order_events where purchase_order_id=$1", [orderId]);
      await sql.query("delete from public.staff_purchase_order_lines where purchase_order_id=$1", [orderId]);
      await sql.query("delete from public.staff_purchase_order_costs where purchase_order_id=$1", [orderId]);
      await sql.query("delete from public.staff_purchase_orders where id=$1", [orderId]);
    }
    await sql.end();
    await localAdminClient().auth.admin.deleteUser(staff.id);
  }
});

test("orders catalogue blades, documents the supplier order, and receives exactly what arrives", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  const sql = await connectAccountDb();
  const catalogue = await createLocalAdminUser("catalogue");
  const warehouse = await createLocalAdminUser("warehouse");
  const goodsContext = await browser.newContext({ baseURL });
  const goods = await goodsContext.newPage();
  const tag = randomUUID().slice(0, 6).toUpperCase();
  const productId = randomUUID();
  const example = (suffix: string) => ({
    id: randomUUID(), sku: `AA-PO-${tag}-${suffix}`, option: `Sample option ${suffix}`,
  });
  const variant = [example("A"), example("B"), example("C"), example("D"), example("E")] as const;
  const [first, second, third, fourth, extra] = variant;
  const supplier = `Example blade supplier ${tag}`;
  const name = `Example blades ${tag}`;
  const note = "FICTIONAL PRIVATE LANDED COST NOTE";
  const reference = `Example delivery ${tag}`;
  const buyerName = `Example buyer ${tag}`;
  const buyerBefore = (await sql.query(
    "select name,address,email,company_number,vat_number from public.staff_purchase_buyer_settings where id",
  )).rows[0];
  let supplierId: string | undefined;
  let orderId: string | undefined;

  try {
    await sql.query("insert into public.products (id,family_code,slug,name,tool_category) values ($1,$2,lower($2),$3,'oscillating')",
      [productId, `AA-PO-${tag}`, name]);
    for (const { id, sku, option } of variant) {
      await sql.query("insert into public.variants (id,sku,product_id,option_label) values ($1,$2,$3,$4)", [id, sku, productId, option]);
    }
    await sql.query("insert into public.compatibility (variant_id,code,code_kind,brand) values ($1,$2,'item_number','zund')",
      [second.id, `MAKER-${tag}`]);
    await setVerifiedStaffSession(page, catalogue, baseURL);
    await setVerifiedStaffSession(goods, warehouse, baseURL);
    await page.goto(orders);
    await expect(heading(page, "Purchase orders")).toBeVisible();
    await expect(page).toHaveTitle("Purchase orders | Edgey");
    await expect(page.getByRole("link", { name: "Order stock", exact: true })).toHaveAttribute("href", orders + "/new");
    await capture(page, "order-stock-purchase-list");
    await goods.goto(orders);
    await expect(heading(goods, "Purchase orders")).toBeVisible();
    await expect(goods.getByRole("link", { name: "Order stock", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Suppliers", exact: true }).click();
    await expect(heading(page, "Suppliers")).toBeVisible();
    await expect(page).toHaveTitle("Suppliers | Edgey");
    await scanBothThemes(page);
    await page.getByRole("link", { name: "Add supplier", exact: true }).click();
    await scanBothThemes(page);
    await expect(page.getByLabel("Default currency")).toHaveValue("");
    await page.getByLabel("Supplier name").fill(supplier);
    await page.getByLabel("Internal notes").fill("FICTIONAL SUPPLIER NOTE");
    await page.getByLabel("Default currency").selectOption("USD");
    await page.getByRole("button", { name: "Save supplier" }).click();
    await expect(heading(page, supplier)).toBeVisible();
    supplierId = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByLabel("Email").fill("supplier@example.test");
    await page.getByLabel("Address").fill("Unit 3\nExample Street");
    await page.getByRole("button", { name: "Save supplier" }).click();
    await expect(page.getByRole("status")).toHaveText("Supplier saved.");
    await scanBothThemes(page);
    await page.goto(orders + "/settings");
    await expect(page.getByLabel("Business name")).toBeVisible();
    await page.getByLabel("Business name").fill(buyerName);
    await page.getByLabel("Address").fill("");
    await page.getByLabel("Email").fill("");
    await page.getByLabel("Company number").fill("EXAMPLE-1234");
    await page.getByLabel("VAT number").fill("");
    await page.getByRole("button", { name: "Save buyer details" }).click();
    await expect(page.getByRole("status")).toHaveText("Buyer details saved.");
    await scanBothThemes(page);

    await page.goto(`/admin/catalogue/${first.id}`);
    await page.getByRole("link", { name: "Add to purchase order" }).click();
    await expect(heading(page, "Add to purchase order")).toBeVisible();
    await expect(page).toHaveTitle("Add to purchase order | Edgey");
    const orderStock = page.getByRole("link", { name: "Order stock", exact: true });
    await expect(orderStock).toHaveAttribute("href", `${orders}/new?variant=${first.id}`);
    await orderStock.click();
    await expect(heading(page, "New purchase order")).toBeVisible();
    const lines = page.getByRole("list", { name: "Selected products" });
    const line = (sku: string) => lines.getByRole("listitem").filter({ hasText: sku });
    await expect(line(first.sku)).toContainText(first.option);
    await page.getByRole("combobox", { name: "Supplier", exact: true }).selectOption(supplierId!);
    await page.getByRole("combobox", { name: "Order currency", exact: true }).selectOption("USD");
    await page.getByLabel("Exchange rate (GBP per 1 unit of order currency)").fill("0.8");
    await page.getByLabel("Order date").fill("2026-11-20");
    await page.getByLabel("Expected date (optional)").fill("2026-12-03");
    await line(first.sku).getByLabel("Quantity").fill("5");
    await line(first.sku).getByLabel("Unit price ex VAT (order currency)").fill("12.34");
    await line(first.sku).getByText("Add detail", { exact: true }).click();
    await line(first.sku).getByLabel("Supplier part number (optional)").fill("PART-A");
    await line(first.sku).getByLabel("Line note (optional)").fill("=Example, with \"quotes\"");
    const search = page.getByLabel("Search products");
    const searchButton = page.getByRole("button", { name: "Search", exact: true });
    await page.getByLabel("Machine brand").selectOption("zund");
    await search.fill("3910301");
    await searchButton.click();
    await expect(page.getByRole("img", { name: "Line drawing for EDG-Z10" })).toBeVisible();
    await capture(page, "catalogue-picker-drawing");
    await search.fill(name);
    await searchButton.click();
    const match = page.getByRole("list", { name: "Matching products" }).getByRole("listitem");
    await expect(match).toHaveCount(1);
    await expect(match).toContainText(second.option);
    await expect(match).toContainText("Draft");
    await match.getByRole("button", { name: `Add ${second.sku}` }).click();
    await line(second.sku).getByLabel("Quantity").fill("3");
    await line(second.sku).getByLabel("Unit price ex VAT (order currency)").fill("10.00");
    await page.getByText("Enter an exact code", { exact: true }).click();
    await page.getByLabel("Exact Edgey code or maker reference").fill(third.sku);
    await page.getByRole("button", { name: "Add by code" }).click();
    await line(third.sku).getByLabel("Quantity").fill("1");
    await line(third.sku).getByLabel("Unit price ex VAT (order currency)").fill("5.00");
    await page.getByText("Import lines", { exact: true }).click();
    await page.getByLabel("Paste spreadsheet rows").fill(`${fourth.sku}\t2\t5.00`);
    await page.getByRole("button", { name: "Preview import" }).click();
    await expect(page.getByRole("heading", { name: "Import preview" })).toBeVisible();
    await page.getByRole("button", { name: "Add 1 line", exact: true }).click();
    await expect(line(fourth.sku).getByLabel("Quantity")).toHaveValue("2");
    await expect(line(first.sku).getByLabel("Quantity")).toHaveValue("5");
    await page.getByText("Charges and order note", { exact: true }).click();
    await page.getByLabel("Shipping", { exact: true }).fill("10");
    await page.getByLabel("Import VAT", { exact: true }).fill("12");
    await page.getByLabel("Import VAT treatment").selectOption("exclude");
    await page.getByLabel("Order note (optional)").fill(note);
    for (const [width, height] of [[1440, 940], [1280, 800], [390, 844], [320, 640]] as const) {
      await page.setViewportSize({ width, height });
      for (const theme of ["light", "dark"] as const) {
        await switchTheme(page, theme);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
      if (width === 1440 || width === 320) await scanBothThemes(page);
      if (width === 1440) {
        await switchTheme(page, "light");
        await capture(page, "catalogue-order-desktop");
      }
      if (width === 390) {
        await switchTheme(page, "dark");
        await capture(page, "catalogue-order-mobile");
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^PO-\d+$/ })).toBeVisible();
    const orderPath = new URL(page.url()).pathname;
    orderId = orderPath.split("/").at(-1);
    const orderNumber = (await page.getByRole("heading", { level: 1 }).textContent())!;
    await scanBothThemes(page);
    await page.getByText("Cancel purchase order", { exact: true }).click();
    await page.getByRole("button", { name: "Confirm cancel purchase order" }).click();
    await expect(page.getByRole("checkbox", { name: "I confirm that this order should be cancelled" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Mark as sent" })).toBeVisible();
    await goods.goto(orders);
    await expect(goods.getByRole("link", { name: orderNumber, exact: true })).toHaveCount(0);

    await page.getByRole("link", { name: "Printable PO" }).click();
    const sheet = page.locator("article.po-document");
    await expect(sheet.getByRole("img", { name: "Edgey", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download PDF", exact: true })).toHaveAttribute("href", orderPath + "/export/pdf");
    await expect(sheet).toContainText(supplier);
    await expect(sheet).toContainText(buyerName);
    await expect(sheet).toContainText("EXAMPLE-1234");
    await expect(sheet).not.toContainText("VAT number");
    await expect(sheet).toContainText(first.option);
    await expect(sheet).toContainText("$106.70");
    await expect(sheet).not.toContainText(/FICTIONAL PRIVATE|FICTIONAL SUPPLIER NOTE|Landed/);
    await scanBothThemes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.setViewportSize({ width: 1280, height: 800 });
    await switchTheme(page, "light");
    await expect(sheet).toContainText("Draft — not issued");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("link", { name: "Back to order" })).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(page.locator("svg:has(#edgey)")).not.toHaveCSS("display", "none");
    await page.emulateMedia({ media: "screen" });
    const csv = await page.request.get(orderPath + "/export");
    expect(csv.ok()).toBe(true);
    expect(csv.headers()["cache-control"]).toContain("no-store");
    const text = await csv.text();
    expect(text).toContain('"Revision",1,');
    expect(text).toContain('"PART-A","\'=Example, with ""quotes""",5,12.34,61.70');
    expect(text).not.toMatch(/FICTIONAL PRIVATE|FICTIONAL SUPPLIER NOTE/);
    await page.getByRole("link", { name: "Back to order", exact: true }).click();
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText("Marked as sent", { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download PDF", exact: true }).click();
    const pdf = await downloadPromise;
    expect(pdf.suggestedFilename()).toBe(orderNumber + ".pdf");
    const { text: pdfText } = await extractText(new Uint8Array(await readFile(await pdf.path())), { mergePages: true });
    for (const field of [orderNumber, supplier, buyerName, first.sku, first.option, "PART-A",
      '=Example, with "quotes"', "$61.70", "$106.70", "3 Dec 2026"]) expect(pdfText).toContain(field);
    expect(pdfText).not.toMatch(/FICTIONAL PRIVATE|FICTIONAL SUPPLIER NOTE|exchange rate|landed cost|VAT number/i);
    await page.getByRole("link", { name: "Printable PO" }).click();
    await expect(sheet).not.toContainText("Draft — not issued");
    await capture(page, "supplier-purchase-order");
    await page.getByRole("link", { name: "Back to order", exact: true }).click();
    await page.getByRole("link", { name: "Amend order" }).click();
    await expect(page.getByRole("combobox", { name: "Supplier", exact: true })).toHaveCount(0);
    await page.getByLabel("Expected date (optional)").fill("2026-12-09");
    await scanBothThemes(page);
    await page.getByRole("button", { name: "Save amendment" }).click();
    await expect(page.getByText("Order amended", { exact: true })).toBeVisible();
    await page.goto(`/admin/catalogue?q=${first.sku}`);
    await expect(page.getByRole("row").filter({ hasText: first.sku })).toContainText("9 Dec 2026");

    await goods.goto(orders);
    await goods.getByRole("link", { name: orderNumber, exact: true }).click();
    await expect(heading(goods, orderNumber)).toBeVisible();
    const warehouseSource = await goods.request.get(orderPath);
    expect(await warehouseSource.text()).not.toMatch(new RegExp(`${supplier}|FICTIONAL PRIVATE|landed_unit_pence|supplier_part_number|12\\.34`));
    expect((await goods.request.get(orderPath + "/export")).status()).toBe(403);
    expect((await goods.request.get(orderPath + "/export/pdf")).status()).toBe(403);
    await expect(goods.getByRole("link", { name: "Download PDF", exact: true })).toHaveCount(0);
    await expect(goods.getByRole("link", { name: "Printable PO" })).toHaveCount(0);
    await goods.goto("/admin/stock");
    await expect(goods.getByRole("row").filter({ hasText: first.sku })).toContainText("9 Dec 2026");
    await goods.goto(orderPath);
    await goods.getByRole("link", { name: "Receive against this PO" }).click();
    await expect(heading(goods, `Receive against ${orderNumber}`)).toBeVisible();
    await expect(goods.getByLabel("Quantity for line 1")).toHaveValue("5");
    await expect(goods.getByLabel("Blade code for line 1")).toHaveJSProperty("readOnly", true);
    await goods.getByLabel("Delivery reference").fill(reference);
    await goods.getByLabel("Quantity for line 1").fill("2");
    await goods.getByLabel("Quantity for line 2").fill("4");
    await goods.getByLabel("Quantity for line 3").fill("0");
    await goods.getByLabel("Quantity for line 4").fill("");
    await goods.getByRole("button", { name: "Add unexpected line" }).click();
    await goods.getByLabel("Blade code for line 5").fill(extra.sku);
    await goods.getByLabel("Quantity for line 5").fill("1");
    await expect(goods.getByLabel(/unit cost/i)).toHaveCount(0);
    await goods.getByRole("button", { name: "Review delivery" }).click();
    await expect(goods.getByRole("heading", { name: "Review delivery" })).toBeVisible();
    await expect(goods.getByText(/Short · .*3 units still outstanding/)).toBeVisible();
    await expect(goods.getByText(/Over · .*1 unit above the outstanding quantity/)).toBeVisible();
    await expect(goods.getByText(/Unexpected · .*1 unit not on the order/)).toBeVisible();
    expect((await sql.query("select sum(stock_on_hand)::int as units from public.variants where id=any($1::uuid[])",
      [variant.map(({ id }) => id)])).rows).toEqual([{ units: 0 }]);
    await scanBothThemes(goods);
    await switchTheme(goods, "light");
    await capture(goods, "receipt-review");
    await goods.setViewportSize({ width: 390, height: 844 });
    await switchTheme(goods, "dark");
    await expect.poll(() => goods.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await capture(goods, "receipt-review-mobile");
    await goods.getByRole("button", { name: "Receive stock", exact: true }).click();
    await expect(heading(goods, reference)).toBeVisible();
    const receiptPath = new URL(goods.url()).pathname;
    await expect(goods.getByRole("link", { name: orderNumber, exact: true })).toBeVisible();
    await expect(goods.getByText("Original purchase cost breakdown")).toHaveCount(0);
    const posted = await sql.query(`
      select v.sku, v.stock_on_hand as stock, c.landed_unit_pence as cost, b.include_import_vat as vat
        from public.staff_deliveries d
        join public.staff_delivery_lines l on l.delivery_id=d.id
        join public.variants v on v.id=l.variant_id
        left join public.staff_receipt_costs c using (stock_movement_id)
        left join public.staff_purchase_receipt_cost_breakdowns b using (stock_movement_id)
      where d.purchase_order_id=$1 order by l.position`, [orderId]);
    expect(posted.rows).toEqual([
      { sku: first.sku, stock: 2, cost: 1080, vat: false },
      { sku: second.sku, stock: 4, cost: 875, vat: false },
      { sku: extra.sku, stock: 1, cost: null, vat: null },
    ]);
    await page.goto(receiptPath);
    await expect(heading(page, reference)).toBeVisible();
    await expect(page.getByText("Original purchase cost breakdown")).toHaveCount(2);
    await expect(page.getByText("Cost to be entered", { exact: true })).toHaveCount(1);
    await page.goto(`${orders}/new?variant=${first.id}`);
    await page.getByRole("combobox", { name: "Supplier", exact: true }).selectOption(supplierId!);
    await page.getByRole("combobox", { name: "Order currency", exact: true }).selectOption("USD");
    const price = line(first.sku).getByLabel("Unit price ex VAT (order currency)");
    await price.fill("15.00");
    await expect(line(first.sku).getByRole("button", { name: /Check last paid price/ })).toHaveCount(0);
    await expect(price).toHaveValue("15.00");
    await price.fill("");
    await line(first.sku).getByRole("button", { name: /Check last paid price/ }).click();
    await expect(price).toHaveValue("");
    await line(first.sku).getByRole("button", { name: "Use last paid · USD 12.34" }).click();
    await expect(price).toHaveValue("12.34");
    await page.goto(orderPath);
    await expect(page.getByRole("link", { name: reference, exact: true })).toBeVisible();
    await expect(page.getByText("Part received", { exact: true })).toHaveCount(2);
    expect(await (await page.request.get(orderPath + "/export")).text()).toContain('"Revision",2,');
    await page.getByText("Close purchase order", { exact: true }).click();
    await page.getByRole("button", { name: "Confirm close purchase order" }).click();
    await expect(page.getByRole("checkbox", { name: "I confirm that no further deliveries are expected" })).toBeFocused();
    await page.getByRole("checkbox", { name: "I confirm that no further deliveries are expected" }).check();
    await page.getByRole("button", { name: "Confirm close purchase order" }).click();
    await expect(page.getByText("Order closed", { exact: true })).toBeVisible();
    expect((await sql.query("select * from public.staff_purchase_order_outstanding where purchase_order_id=$1", [orderId])).rows).toEqual([]);
  } finally {
    const ids = variant.map(({ id }) => id);
    if (orderId) {
      await sql.query("delete from public.staff_purchase_receipt_cost_breakdowns where stock_movement_id in (select id from public.stock_movements where variant_id=any($1::uuid[]))", [ids]);
      await sql.query("delete from public.staff_receipt_costs where variant_id=any($1::uuid[])", [ids]);
      await sql.query("delete from public.staff_delivery_lines where variant_id=any($1::uuid[])", [ids]);
      await sql.query("delete from private.staff_delivery_payloads where delivery_id in (select id from public.staff_deliveries where purchase_order_id=$1)", [orderId]);
      await sql.query("delete from public.staff_deliveries where purchase_order_id=$1", [orderId]);
      await sql.query("delete from private.staff_purchase_order_amendments where event_id in (select id from public.staff_purchase_order_events where purchase_order_id=$1)", [orderId]);
      await sql.query("delete from public.staff_purchase_order_events where purchase_order_id=$1", [orderId]);
      await sql.query("delete from public.staff_purchase_order_lines where purchase_order_id=$1", [orderId]);
      await sql.query("delete from public.staff_purchase_order_costs where purchase_order_id=$1", [orderId]);
      await sql.query("delete from public.staff_purchase_orders where id=$1", [orderId]);
    }
    if (supplierId) await sql.query("delete from public.staff_suppliers where id=$1", [supplierId]);
    await sql.query("delete from public.stock_movements where variant_id=any($1::uuid[])", [ids]);
    await sql.query("delete from public.compatibility where variant_id=any($1::uuid[])", [ids]);
    await sql.query("delete from public.variants where id=any($1::uuid[])", [ids]);
    await sql.query("delete from public.products where id=$1", [productId]);
    if (buyerBefore) await sql.query(
      "update public.staff_purchase_buyer_settings set name=$1,address=$2,email=$3,company_number=$4,vat_number=$5 where id and name=$6",
      [buyerBefore.name, buyerBefore.address, buyerBefore.email, buyerBefore.company_number, buyerBefore.vat_number, buyerName]);
    else await sql.query("delete from public.staff_purchase_buyer_settings where id and name=$1", [buyerName]);
    await sql.end();
    await goodsContext.close();
    await localAdminClient().auth.admin.deleteUser(catalogue.id);
    await localAdminClient().auth.admin.deleteUser(warehouse.id);
  }
});
