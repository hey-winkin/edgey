import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb, createAccountCatalogue } from "../helpers/account-fixture";
import { scanAccessibility, themes } from "../helpers/accessibility";
import { switchTheme } from "../helpers/navigation";
import { setVerifiedStaffSession } from "./admin-fixtures";

const stock = "/admin/catalogue";
const newOrder = "/admin/purchase-orders/new";
const renders = process.env.EDGEY_STOCK_ORDER_RENDERS;

test("selecting stock opens an unsaved draft with the latest received price", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const db = await connectAccountDb();
  const staff = await createLocalAdminUser("catalogue");
  const warehouse = await createLocalAdminUser("warehouse");
  const goods = await browser.newContext({ baseURL });
  const supplier = randomUUID();
  let fixture: Awaited<ReturnType<typeof createAccountCatalogue>> | undefined;
  let draftId: string | undefined;
  try {
    fixture = await createAccountCatalogue(db);
    const { available, soldOut, selected } = fixture;
    const prefix = available.sku.slice(0, -3);
    const path = `${stock}?q=${prefix}`;
    await db.query("update public.variants set publication_status = 'archived' where id = $1", [selected.id]);
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'warehouse')", [staff.id]);
    await db.query("insert into public.staff_suppliers (id, name, default_currency) values ($1, 'Fictional Stock Supplier', 'GBP')", [supplier]);
    for (const price of [1100, 1250]) {
      await db.query(`
        with movement as (
          insert into public.stock_movements (kind, operation_key, variant_id, actor_id, on_hand_delta, reserved_delta)
          values ('receive', $1, $2, $3, 1, 0) returning id
        )
        insert into public.staff_receipt_costs
          (stock_movement_id, variant_id, received_quantity, supplier_unit_minor, currency, landed_unit_pence, actor_id, recorded_at)
        select id, $2, 1, $4, 'GBP', $4 + 200, $3, now() from movement
      `, [randomUUID(), available.id, staff.id, price]);
    }
    await db.query(`
      insert into public.staff_variant_cost_audit
        (variant_id, stock_movement_id, old_cost, new_cost, actor_id, recorded_at)
      select variant_id, stock_movement_id, '{"supplier_unit_minor": 1250}', '{"supplier_unit_minor": 1375}', $2, now()
      from public.staff_receipt_costs where variant_id = $1 order by stock_movement_id desc limit 1
    `, [available.id, staff.id]);

    await setVerifiedStaffSession(page, staff, baseURL);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Stock", exact: true })).toBeVisible();
    await expect(page).toHaveTitle("Stock | Edgey");
    await expect(page.locator(".admin-location")).toHaveText("Purchasing");
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Adjust stock", exact: true })).toHaveAttribute("href", "/admin/stock");
    const select = (sku: string) => page.getByRole("checkbox", { name: `Select ${sku}`, exact: true });
    const all = page.getByRole("checkbox", { name: "Select all on this page" });
    const order = page.getByRole("button", { name: "Order stock", exact: true });
    await expect(select(selected.sku)).toHaveCount(0);
    await expect(main.getByRole("link", { name: /Add to purchase order/ })).toHaveCount(0);
    await expect(order).toBeHidden();
    await all.focus();
    await all.press("Space");
    await expect(select(available.sku)).toBeChecked();
    await expect(select(soldOut.sku)).toBeChecked();
    await expect(page.getByText("2 blades selected", { exact: true })).toBeVisible();
    await all.press("Space");
    await expect(select(available.sku)).not.toBeChecked();
    await expect(order).toBeHidden();
    await select(available.sku).focus();
    await select(available.sku).press("Space");
    await expect(all).toHaveJSProperty("indeterminate", true);
    await select(soldOut.sku).focus();
    await select(soldOut.sku).press("Space");
    await expect(all).toBeChecked();
    await expect(order).toHaveClass(/\bprimary\b/);

    for (const theme of themes) {
      await switchTheme(page, theme);
      for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 800]] as const) {
        await page.setViewportSize({ width, height });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await expect(order).toBeVisible();
        const hitbox = await select(available.sku).evaluate((input: HTMLInputElement) =>
          input.labels?.[0]?.getBoundingClientRect().toJSON());
        expect(hitbox?.width).toBeGreaterThanOrEqual(44);
        expect(hitbox?.height).toBeGreaterThanOrEqual(44);
        await scanAccessibility(page, theme);
        if (renders) {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
          await page.screenshot({ path: join(renders, `selected-stock-${width}-${theme}.png`), fullPage: true });
        }
      }
    }

    await order.click();
    await expect(page).toHaveURL(/\/admin\/purchase-orders\/new\?variants=/);
    await expect(page.getByRole("heading", { level: 1, name: "New purchase order" })).toBeVisible();
    const lines = page.getByRole("list", { name: "Selected products" }).getByRole("listitem");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText(available.sku);
    await expect(lines.nth(1)).toContainText(soldOut.sku);
    const quantities = page.getByLabel("Quantity", { exact: true });
    await expect(quantities.nth(0)).toHaveValue("");
    await expect(quantities.nth(0)).toBeFocused();
    await expect(quantities.nth(1)).toHaveValue("");
    const supplierField = page.getByRole("combobox", { name: "Supplier", exact: true });
    await expect(supplierField).toHaveValue("");
    const prices = page.getByLabel("Unit price ex VAT (order currency)");
    await expect(prices.nth(0)).toHaveValue("13.75");
    await expect(prices.nth(1)).toHaveValue("");
    draftId = await page.locator('input[name="order_id"]').inputValue();
    expect((await db.query("select id from public.staff_purchase_orders where id = $1", [draftId])).rows).toEqual([]);
    const warehousePage = await goods.newPage();
    await setVerifiedStaffSession(warehousePage, warehouse, baseURL);
    await warehousePage.goto(page.url());
    await expect(warehousePage).toHaveURL(/\/admin$/);
    await warehousePage.goto(path);
    await expect(warehousePage).toHaveURL(/\/admin$/);
    await expect(warehousePage.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);

    await scanAccessibility(page, "light");
    if (renders) {
      await page.screenshot({ path: join(renders, "stock-draft-320-light.png") });
      await page.setViewportSize({ width: 1280, height: 800 });
      await quantities.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(renders, "stock-draft-1280-light.png") });
    }
    await quantities.nth(0).fill("3");
    await quantities.nth(1).fill("4");
    await supplierField.selectOption(supplier);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(`/admin/purchase-orders/${draftId}`);
    const saved = await db.query(`
      select o.status, c.supplier_id, l.sku, l.quantity, lc.unit_price_minor
      from public.staff_purchase_orders o join public.staff_purchase_order_lines l on l.purchase_order_id = o.id
      join public.staff_purchase_order_costs c on c.purchase_order_id = o.id
      join public.staff_purchase_order_line_costs lc
        on lc.purchase_order_id = l.purchase_order_id and lc.variant_id = l.variant_id
      where o.id = $1 order by l.position
    `, [draftId]);
    expect(saved.rows).toEqual([
      { status: "draft", supplier_id: supplier, sku: available.sku, quantity: 3, unit_price_minor: 1375 },
      { status: "draft", supplier_id: supplier, sku: soldOut.sku, quantity: 4, unit_price_minor: null },
    ]);
  } finally {
    try {
      if (draftId) {
        await db.query("delete from public.staff_purchase_order_events where purchase_order_id = $1", [draftId]);
        await db.query("delete from public.staff_purchase_order_lines where purchase_order_id = $1", [draftId]);
        await db.query("delete from public.staff_purchase_order_costs where purchase_order_id = $1", [draftId]);
        await db.query("delete from public.staff_purchase_orders where id = $1", [draftId]);
      }
      await db.query("delete from public.staff_suppliers where id = $1", [supplier]);
      if (fixture) {
        await db.query("delete from public.staff_variant_cost_audit where variant_id = $1", [fixture.available.id]);
        await db.query("delete from public.staff_receipt_costs where variant_id = $1", [fixture.available.id]);
        await db.query("delete from public.stock_movements where variant_id in (select id from public.variants where product_id = $1)", [fixture.productId]);
        await db.query("delete from public.variants where product_id = $1", [fixture.productId]);
        await db.query("delete from public.products where id = $1", [fixture.productId]);
      }
    } finally {
      await db.end();
      await goods.close();
      await localAdminClient().auth.admin.deleteUser(staff.id);
      await localAdminClient().auth.admin.deleteUser(warehouse.id);
    }
  }
});

test("finance can keep stock selections and post a draft without JavaScript", async ({ browser, baseURL }) => {
  const staff = await createLocalAdminUser("finance");
  const native = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await native.newPage();
    await setVerifiedStaffSession(page, staff, baseURL);
    await page.goto(`${stock}?q=EDG-Z10`);
    await expect(page.getByRole("link", { name: "Adjust stock", exact: true })).toHaveCount(0);
    const first = page.getByRole("checkbox", { name: "Select EDG-Z10", exact: true });
    const second = page.getByRole("checkbox", { name: "Select EDG-Z11", exact: true });
    await page.getByRole("button", { name: "Select this page", exact: true }).click();
    await expect(first).toBeChecked();
    await page.getByRole("searchbox", { name: "Search by code" }).fill("EDG-Z11");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(first).toHaveCount(0);
    await second.focus();
    await second.press("Space");
    const post = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === stock);
    await page.getByRole("button", { name: "Order stock", exact: true }).click();
    await post;
    await expect(page).toHaveURL(new RegExp(`${newOrder}\\?variants=`));
    const lines = page.getByRole("list", { name: "Selected products" }).getByRole("listitem");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText("EDG-Z10");
    await expect(lines.nth(1)).toContainText("EDG-Z11");
    const quantities = page.getByLabel("Quantity", { exact: true });
    await expect(quantities.first()).toHaveValue("");
    await expect(quantities.first()).toBeFocused();
    await expect(quantities.last()).toHaveValue("");
  } finally {
    await native.close();
    await localAdminClient().auth.admin.deleteUser(staff.id);
  }
});

test("archiving a selected blade asks staff to review before opening a draft", async ({ page, baseURL }) => {
  const db = await connectAccountDb();
  const staff = await createLocalAdminUser("finance");
  let fixture: Awaited<ReturnType<typeof createAccountCatalogue>> | undefined;
  try {
    fixture = await createAccountCatalogue(db);
    const { available, soldOut } = fixture;
    await setVerifiedStaffSession(page, staff, baseURL);
    await page.goto(`${stock}?q=${available.sku.slice(0, -3)}`);
    for (const { sku } of [available, soldOut]) await page.getByRole("checkbox", { name: `Select ${sku}`, exact: true }).check();
    await db.query("update public.variants set publication_status = 'archived' where id = $1", [available.id]);
    const order = page.getByRole("button", { name: "Order stock", exact: true });
    await order.click();
    await expect(page.getByRole("status").filter({ hasText: "Some selected blades are no longer available" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: `Select ${available.sku}`, exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: `Select ${soldOut.sku}`, exact: true })).toBeChecked();
    await order.click();
    await expect(page).toHaveURL(new RegExp(`${newOrder}\\?variants=`));
    const lines = page.getByRole("list", { name: "Selected products" }).getByRole("listitem");
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText(soldOut.sku);
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
