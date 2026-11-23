import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { encodeStockSelection } from "@/lib/admin/stock-selection";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb, createAccountCatalogue } from "../helpers/account-fixture";
import { setVerifiedStaffSession } from "./admin-fixtures";

const orders = "/admin/purchase-orders";
const newOrder = `${orders}/new`;

async function fixture() {
  const db = await connectAccountDb();
  const staff = await createLocalAdminUser("finance");
  const variants = await createAccountCatalogue(db);
  const amber = randomUUID();
  const blue = randomUUID();
  const orderIds: string[] = [];
  await db.query(`
    insert into public.staff_suppliers (id, name, default_currency, lead_time_days)
    values ($1, 'Amber Components', 'USD', 7), ($2, 'Blue Components', 'EUR', 2)
  `, [amber, blue]);
  await db.query(`
    insert into public.staff_variant_suppliers (variant_id, supplier_id, supplier_part_number, is_usual)
    values ($1, $3, 'AMBER-45', true), ($2, $3, 'AMBER-60', true), ($1, $4, 'BLUE-45', false)
  `, [variants.available.id, variants.soldOut.id, amber, blue]);
  return {
    db, staff, variants, amber, blue, orderIds,
    finish: async () => {
      try {
        for (const orderId of orderIds) {
          await db.query("delete from public.staff_purchase_order_events where purchase_order_id = $1", [orderId]);
          await db.query("delete from public.staff_purchase_order_lines where purchase_order_id = $1", [orderId]);
          await db.query("delete from public.staff_purchase_order_costs where purchase_order_id = $1", [orderId]);
          await db.query("delete from public.staff_purchase_orders where id = $1", [orderId]);
        }
        await db.query("delete from public.staff_variant_suppliers where supplier_id in ($1, $2)", [amber, blue]);
        await db.query("delete from public.staff_suppliers where id in ($1, $2)", [amber, blue]);
        await db.query("delete from public.stock_movements where variant_id in (select id from public.variants where product_id = $1)", [variants.productId]);
        await db.query("delete from public.variants where product_id = $1", [variants.productId]);
        await db.query("delete from public.products where id = $1", [variants.productId]);
      } finally {
        await db.end();
        await localAdminClient().auth.admin.deleteUser(staff.id);
      }
    },
  };
}

const supplierField = (page: Page) => page.getByRole("combobox", { name: "Supplier", exact: true });
const currencyField = (page: Page) => page.getByRole("combobox", { name: "Order currency" });
const expectedField = (page: Page) => page.getByLabel("Expected date (optional)");
const exchangeField = (page: Page) => page.getByLabel("Exchange rate (GBP per 1 unit of order currency)");
const partField = (page: Page, id: string) => page.locator(`input[name="part:${id}"]`);
const storedOrderId = (page: Page) => page.locator('input[name="order_id"]').inputValue();

test("reopening a saved draft keeps intentionally blank fields and line parts", async ({ page, baseURL }) => {
  const f = await fixture();
  try {
    const historical = randomUUID();
    const withSupplier = randomUUID();
    const withoutSupplier = randomUUID();
    f.orderIds.push(historical, withSupplier, withoutSupplier);
    const reference = `PO-SAVED-${historical.slice(0, 8)}`;
    await f.db.query(`
      insert into public.staff_purchase_orders (id,number,status,ordered_on,revision)
      values ($1,$4,'sent','2026-11-01',1), ($2,$4 || '-A','draft','2026-11-03',1), ($3,$4 || '-B','draft','2026-11-03',1)
    `, [historical, withSupplier, withoutSupplier, reference]);
    await f.db.query(`
      insert into public.staff_purchase_order_costs (purchase_order_id,supplier_id,currency,exchange_rate,
        shipping_minor,duty_minor,other_minor,import_vat_minor)
      values ($1,$4,'USD',0.8123,0,0,0,0), ($2,$4,'USD',null,0,0,0,0), ($3,null,'GBP',1,0,0,0,0)
    `, [historical, withSupplier, withoutSupplier, f.amber]);
    const blade = f.variants.available;
    for (const id of [withSupplier, withoutSupplier]) {
      await f.db.query(`
        insert into public.staff_purchase_order_lines (purchase_order_id,variant_id,position,sku,blade_name,quantity)
        values ($1,$2,1,$3,'Fixture blade',3)
      `, [id, blade.id, blade.sku]);
      await f.db.query("insert into public.staff_purchase_order_line_costs (purchase_order_id,variant_id) values ($1,$2)", [id, blade.id]);
    }
    await setVerifiedStaffSession(page, f.staff, baseURL);
    await page.goto(`${orders}/${withSupplier}/edit`);
    await expect(supplierField(page)).toHaveValue(f.amber);
    await expect(currencyField(page)).toHaveValue("USD");
    await expect(expectedField(page)).toHaveValue("");
    await expect(exchangeField(page)).toHaveValue("");
    await page.getByText("Add detail", { exact: true }).click();
    await expect(partField(page, blade.id)).toHaveValue("");
    await page.goto(`${orders}/${withoutSupplier}/edit`);
    await expect(supplierField(page)).toHaveValue("");
    await expect(currencyField(page)).toHaveValue("GBP");
    await expect(expectedField(page)).toHaveValue("");
  } finally {
    await f.finish();
  }
});

test("bulk PO defaults survive hydration, preserve deliberate overrides and only remember checked changes", async ({ page, baseURL }) => {
  const f = await fixture();
  let releaseScripts = () => {};
  const scripts = new Promise<void>((resolve) => { releaseScripts = resolve; });
  try {
    const historical = randomUUID();
    const draft = randomUUID();
    const reference = `PO-TEST-${historical.slice(0, 8).toUpperCase()}`;
    f.orderIds.push(historical, draft);
    await f.db.query(`
      insert into public.staff_purchase_orders (id, number, status, ordered_on, revision)
      values ($1, $3, 'sent', '2090-11-21', 1), ($2, $4, 'draft', '2090-11-22', 1)
    `, [historical, draft, reference, reference + "-DRAFT"]);
    await f.db.query(`
      insert into public.staff_purchase_order_costs (purchase_order_id,supplier_id,currency,exchange_rate,
        shipping_minor,duty_minor,other_minor,import_vat_minor)
      values ($1,$3,'USD',0.78123456,0,0,0,0), ($2,$3,'USD',0.123,0,0,0,0)
    `, [historical, draft, f.amber]);

    await setVerifiedStaffSession(page, f.staff, baseURL);
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => { await scripts; await route.continue(); });
    await page.goto(`${newOrder}?variants=${encodeStockSelection([f.variants.available.id, f.variants.soldOut.id])}`, { waitUntil: "commit" });
    const order = await storedOrderId(page);
    f.orderIds.push(order);
    const { available, soldOut } = f.variants;
    const lines = page.getByRole("list", { name: "Selected products" }).getByRole("listitem");
    await expect(supplierField(page)).toHaveValue(f.amber);
    await expect(currencyField(page)).toHaveValue("USD");
    await expect(exchangeField(page)).toHaveValue("0.78123456");
    await expect(page.getByText(`Last used on ${reference} · 2090-11-21.`, { exact: false })).toBeVisible();
    await lines.nth(0).getByText("Edit detail", { exact: true }).click();
    await expect(partField(page, available.id)).toHaveValue("AMBER-45");

    const renders = process.env.EDGEY_STAFF_JOIN_RENDERS;
    for (const width of [390, 320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      if (renders && width === 390) {
        await mkdir(renders, { recursive: true });
        await page.getByRole("heading", { name: "Order details", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(renders, "purchase-supplier-defaults-390.png"), fullPage: true });
      }
    }

    await currencyField(page).selectOption("GBP");
    await currencyField(page).selectOption("USD");
    await expectedField(page).fill("2026-12-19");
    await exchangeField(page).fill("0.7999");
    await partField(page, available.id).fill("AMBER-45-UPDATED");
    const currencyEdited = page.locator('input[name="edited:currency"]');
    await expect(currencyEdited).toHaveValue("1");
    releaseScripts();
    await expect(page.locator("[data-supplier-defaults-live]")).toBeAttached();
    await expect(currencyEdited).toHaveValue("1");
    await supplierField(page).selectOption(f.blue);
    await expect(currencyField(page)).toHaveValue("USD");
    await expect(expectedField(page)).toHaveValue("2026-12-19");
    await expect(exchangeField(page)).toHaveValue("0.7999");
    await expect(partField(page, available.id)).toHaveValue("BLUE-45");
    await expect(partField(page, soldOut.id)).toHaveValue("");
    await supplierField(page).selectOption(f.amber);
    await expect(partField(page, available.id)).toHaveValue("AMBER-45-UPDATED");
    await expect(partField(page, soldOut.id)).toHaveValue("AMBER-60");
    await lines.nth(1).getByText("Edit detail", { exact: true }).click();
    await partField(page, soldOut.id).fill("ORDER-ONLY-60");
    for (const line of await lines.all()) await line.getByLabel("Quantity").fill("2");
    const firstOffer = lines.nth(0).getByRole("checkbox", { name: /Remember a changed part number/ });
    await expect(firstOffer).not.toBeChecked();
    await firstOffer.check();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(`${orders}/${order}`);
    expect((await f.db.query(`
      select c.currency, c.exchange_rate::text, o.expected_on::text, l.supplier_part_number, a.supplier_part_number as registered
      from public.staff_purchase_orders o join public.staff_purchase_order_costs c on c.purchase_order_id = o.id
      join public.staff_purchase_order_line_costs l on l.purchase_order_id = o.id
      join public.staff_variant_suppliers a on a.variant_id = l.variant_id and a.supplier_id = c.supplier_id
      where o.id = $1 order by l.supplier_part_number
    `, [order])).rows).toEqual([
      { currency: "USD", exchange_rate: "0.7999", expected_on: "2026-12-19", supplier_part_number: "AMBER-45-UPDATED", registered: "AMBER-45-UPDATED" },
      { currency: "USD", exchange_rate: "0.7999", expected_on: "2026-12-19", supplier_part_number: "ORDER-ONLY-60", registered: "AMBER-60" },
    ]);
    await page.goto(`${orders}/${order}/edit`);
    await expect(expectedField(page)).toHaveValue("2026-12-19");
    await expect(exchangeField(page)).toHaveValue("0.7999");
    await expect(partField(page, soldOut.id)).toHaveValue("ORDER-ONLY-60");
  } finally {
    releaseScripts();
    await f.finish();
  }
});

test("native forms apply lead time and remember the first usual supplier only on save", async ({ browser, baseURL }) => {
  const f = await fixture();
  const native = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await native.newPage();
    await setVerifiedStaffSession(page, f.staff, baseURL);
    await page.goto(`${newOrder}?variant=${f.variants.selected.id}`);
    const order = await storedOrderId(page);
    f.orderIds.push(order);
    await expect(supplierField(page)).toHaveValue("");
    await supplierField(page).selectOption(f.blue);
    await page.getByLabel("Order date").fill("2026-12-30");
    await page.getByRole("button", { name: "Apply supplier defaults" }).click();
    await expect(currencyField(page)).toHaveValue("EUR");
    await expect(expectedField(page)).toHaveValue("2027-01-01");
    await page.getByText("Add detail", { exact: true }).click();
    const remember = page.getByRole("checkbox", { name: /Remember Blue Components as this product’s usual supplier/ });
    await expect(remember).not.toBeChecked();
    await remember.check();
    expect((await f.db.query("select supplier_id from public.staff_variant_suppliers where variant_id = $1", [f.variants.selected.id])).rows).toEqual([]);
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page).toHaveURL(`${orders}/${order}`);
    expect((await f.db.query(`
      select supplier_id, supplier_part_number, is_usual from public.staff_variant_suppliers where variant_id = $1
    `, [f.variants.selected.id])).rows).toEqual([{ supplier_id: f.blue, supplier_part_number: null, is_usual: true }]);
  } finally {
    await native.close();
    await f.finish();
  }
});
