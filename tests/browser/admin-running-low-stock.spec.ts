import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { accountEmail, connectAccountDb, createAccountCatalogue, createAccountOrder } from "../helpers/account-fixture";
import { scanAccessibility, themes } from "../helpers/accessibility";
import { switchTheme } from "../helpers/navigation";
import { setVerifiedStaffSession } from "./admin-fixtures";

test("Purchasing links to preselected low-cover blades after accounting for stock on order", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const db = await connectAccountDb();
  const staff = await createLocalAdminUser("finance");
  const po = randomUUID();
  let catalogue: Awaited<ReturnType<typeof createAccountCatalogue>> | undefined;
  let orderId: string | undefined;
  try {
    catalogue = await createAccountCatalogue(db);
    const { available, soldOut, selected } = catalogue;
    const order = await createAccountOrder(db, {
      buyerId: null, email: accountEmail(), state: "dispatched", createdAt: new Date().toISOString(),
      lines: [available, soldOut].map((blade) => ({ ...blade, quantity: 60, price: 1800 })),
    });
    orderId = order.id;
    await db.query(`
      insert into public.staff_purchase_orders (id,number,status,ordered_on,revision)
      values ($1,$2,'sent',current_date,1)
    `, [po, `TEST-LOW-${po.slice(0, 8)}`]);
    await db.query(`
      insert into public.staff_purchase_order_lines (purchase_order_id,variant_id,position,sku,blade_name,quantity)
      values ($1,$2,1,$3,'Synthetic incoming blades',35)
    `, [po, soldOut.id, soldOut.sku]);
    await setVerifiedStaffSession(page, staff, baseURL);
    await page.goto("/admin");
    const desk = page.getByRole("region", { name: "Purchasing", exact: true });
    const reminder = desk.getByRole("link", { name: /^\d+ blades? running low$/ });
    await expect(reminder).toHaveAttribute("href", "/admin/catalogue?view=running-low");
    await reminder.click();
    await expect(page).toHaveURL(/\/admin\/catalogue\?view=running-low$/);
    await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeVisible();
    await expect(page.getByText(/less than two weeks’ cover/)).toBeVisible();
    const first = page.getByRole("checkbox", { name: `Select ${available.sku}`, exact: true });
    await expect(first).toBeChecked();
    for (const blade of [soldOut, selected]) {
      await expect(page.getByRole("checkbox", { name: `Select ${blade.sku}`, exact: true })).toHaveCount(0);
    }
    for (const theme of themes) {
      await switchTheme(page, theme);
      for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 800]] as const) {
        await page.setViewportSize({ width, height });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await expect(page.getByRole("button", { name: "Order stock", exact: true })).toBeVisible();
        await scanAccessibility(page, theme);
        const dir = process.env.EDGEY_STAFF_JOIN_RENDERS;
        if (dir && (width === 1280 || width === 390)) {
          await page.screenshot({ path: join(dir, `running-low-${width}-${theme}.png`), fullPage: true });
        }
      }
    }
    await page.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(first).not.toBeChecked();
    await expect(page).toHaveURL(/view=running-low/);
    await first.check();
    await page.getByRole("button", { name: "Order stock", exact: true }).click();
    const lines = page.getByRole("list", { name: "Selected products" }).getByRole("listitem");
    await expect(lines).toHaveCount(1);
    await expect(lines.first()).toContainText(available.sku);
  } finally {
    try {
      if (orderId) {
        await db.query("delete from public.order_items where order_id = $1", [orderId]);
        await db.query("delete from public.orders where id = $1", [orderId]);
      }
      await db.query("delete from public.staff_purchase_order_lines where purchase_order_id = $1", [po]);
      await db.query("delete from public.staff_purchase_orders where id = $1", [po]);
      if (catalogue) {
        await db.query("delete from public.stock_movements where variant_id in (select id from public.variants where product_id = $1)", [catalogue.productId]);
        await db.query("delete from public.variants where product_id = $1", [catalogue.productId]);
        await db.query("delete from public.products where id = $1", [catalogue.productId]);
      }
    } finally {
      await db.end();
      await localAdminClient().auth.admin.deleteUser(staff.id);
    }
  }
});
