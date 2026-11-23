import { openStaffMenu } from "../helpers/navigation";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { connectAccountDb, createAccountCatalogue, createAccountOrder, accountEmail } from "../helpers/account-fixture";
import { setVerifiedStaffSession } from "./admin-fixtures";

test("sales works at 320px with keyboard sorting, date filters, chart data and downloads", async ({ page, baseURL }) => {
  const db = await connectAccountDb();
  const { available, productId } = await createAccountCatalogue(db);
  let orderId: string | undefined;
  try {
    orderId = (await createAccountOrder(db, {
      buyerId: null, email: accountEmail(), state: "dispatched", createdAt: "2001-10-28T00:30:00Z",
      lines: [{ ...available, quantity: 2, price: 1675 }],
    })).id;
    await page.setViewportSize({ width: 320, height: 720 });
    await setVerifiedStaffSession(page, await createLocalAdminUser("finance"), baseURL);
    await page.goto("/admin");
    await (await openStaffMenu(page)).getByRole("link", { name: "Sales reports", exact: true }).click();
    await page.getByLabel("Period").selectOption("custom");
    await page.getByLabel("From", { exact: true }).fill("2001-10-27");
    await page.getByLabel("To", { exact: true }).fill("2001-10-29");
    await page.getByLabel("Show chart by").selectOption("week");
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    await expect(page.getByText("27 Oct 2001 – 29 Oct 2001", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /bar chart of booked product revenue/i })).toBeVisible();
    await page.getByText("Read chart values").click();
    await expect(page.getByRole("table", { name: "Revenue chart values" })).toContainText("£33.50");
    const products = page.getByRole("table", { name: "Product sales" });
    const row = products.getByRole("row").filter({ hasText: available.sku });
    await expect(row).toContainText("Cost missing");
    await expect(products.getByRole("row").nth(1)).toContainText(available.sku);
    const sort = products.getByRole("link", { name: "Sort by units, descending" });
    await sort.focus();
    await page.keyboard.press("Enter");
    await expect(products.getByRole("columnheader", { name: /sort by units/i })).toHaveAttribute("aria-sort", "descending");
    const reverse = products.getByRole("link", { name: "Sort by units, ascending" });
    await reverse.focus();
    await page.keyboard.press("Enter");
    await expect(products.getByRole("columnheader", { name: /sort by units/i })).toHaveAttribute("aria-sort", "ascending");
    await expect(products.getByRole("row").last()).toContainText(available.sku);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);

    const csv = await page.request.get((await page.getByRole("link", { name: "Download daily sales CSV" }).getAttribute("href"))!);
    expect(csv.ok()).toBe(true);
    expect(csv.headers()["content-disposition"]).toContain("2001-10-27-to-2001-10-29");
    expect(await csv.text()).toContain('"2001-10-28",33.50,8.09,6.95,1,2,0.00,0.00');
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download product sales CSV" }).click();
    expect((await download).suggestedFilename()).toBe("edgey-sales-products-2001-10-27-to-2001-10-29.csv");

    await page.getByLabel("From", { exact: true }).fill("2001-10-30");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText(/enter a valid start and end date/i)).toBeFocused();
    await expect(page.getByLabel("From", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("link", { name: "Download daily sales CSV" })).toHaveCount(0);
  } finally {
    if (orderId) {
      await db.query("delete from public.order_items where order_id = $1", [orderId]);
      await db.query("delete from public.orders where id = $1", [orderId]);
    }
    await db.query("delete from public.stock_movements where variant_id in (select id from public.variants where product_id = $1)", [productId]);
    await db.query("delete from public.variants where product_id = $1", [productId]);
    await db.query("delete from public.products where id = $1", [productId]);
    await db.end();
  }
});

test("warehouse and catalogue can review sales and export products without margin", async ({ browser, baseURL }) => {
  for (const role of ["warehouse", "catalogue"] as const) {
    const page = await browser.newPage({ baseURL });
    try {
      await setVerifiedStaffSession(page, await createLocalAdminUser(role), baseURL);
      await page.goto("/admin/sales?sort=marginPence&dir=asc");
      await expect(page.getByRole("heading", { name: "Sales", exact: true })).toBeVisible();
      await expect(page.getByText("Gross margin", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("columnheader", { name: /sort by revenue,/i })).toHaveAttribute("aria-sort", "descending");
      const link = await page.getByRole("link", { name: "Download product sales CSV" }).getAttribute("href");
      const csv = await page.request.get(link!);
      expect(csv.ok()).toBe(true);
      expect(await csv.text()).not.toMatch(/Gross margin|Cost status|Cost missing/i);
    } finally {
      await page.close();
    }
  }
});
