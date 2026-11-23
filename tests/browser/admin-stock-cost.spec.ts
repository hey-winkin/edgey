import { openStaffMenu } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { setVerifiedStaffSession } from "./admin-fixtures";

async function createStockVariant() {
  const db = localAdminClient();
  const family = await db.from("variants").select("product_id").eq("sku", "EDG-SUM-9802").single();
  if (family.error) throw family.error;
  const id = randomUUID();
  const sku = `EDG-ADMIN-STOCK-${id.slice(0, 8).toUpperCase()}`;
  const { error } = await db.from("variants").insert({
    id, sku, product_id: family.data.product_id, option_label: "Stock test fixture",
    price_1_4_pence: 2095, price_5_9_pence: 1850, price_10_plus_pence: 1595,
  });
  if (error) throw error;
  return { id, sku };
}

test("the owner estimates cost, receives stock at actual cost, then records a signed adjustment", async ({ page, baseURL }) => {
  const db = localAdminClient();
  const staff = await createLocalAdminUser("warehouse");
  const membership = await db.from("staff_members").insert({ user_id: staff.id, role: "catalogue" });
  if (membership.error) throw membership.error;
  const { id, sku } = await createStockVariant();
  await setVerifiedStaffSession(page, staff, baseURL);
  await page.goto(`/admin/catalogue/${id}`);
  await page.getByLabel("Supplier unit price", { exact: true }).fill("16.90");
  await page.getByLabel("Supplier currency", { exact: true }).selectOption("USD");
  await page.getByLabel("Landed unit cost (£)", { exact: true }).fill("17");
  await page.getByRole("button", { name: "Save cost estimate" }).click();
  await expect(page.getByText("Cost estimate saved.", { exact: true })).toBeVisible();
  await expect(page.getByText(/below landed cost/i).first()).toBeVisible();
  await page.getByLabel("1–4 blades (£ ex VAT)", { exact: true }).fill("20.85");
  await page.getByRole("button", { name: "Save selling data" }).click();
  await expect(page.getByText("Selling data saved.", { exact: true })).toBeVisible();
  expect((await db.from("variants").select("price_1_4_pence").eq("id", id).single()).data?.price_1_4_pence).toBe(2085);

  await (await openStaffMenu(page)).getByRole("link", { name: "Stock and adjustments", exact: true }).click();
  await page.getByRole("link", { name: sku, exact: true }).click();
  await page.getByLabel("Received quantity").fill("8");
  await page.getByText("Add receipt costs (optional)").click();
  await page.getByLabel("Supplier unit price", { exact: true }).fill("4.20");
  await page.getByLabel("Supplier currency", { exact: true }).selectOption("USD");
  await page.getByLabel("Landed unit cost (£)", { exact: true }).fill("3.50");
  await page.getByRole("button", { name: "Record stock receipt" }).click();
  await expect(page.getByText("Stock receipt recorded.", { exact: true })).toBeVisible();
  const ledger = page.getByRole("table", { name: "Movement ledger" });
  const receipt = ledger.getByRole("row").filter({ hasText: "£3.50 landed" });
  await expect(receipt).toContainText("USD");
  await expect(receipt).toContainText("+8");

  await page.getByLabel("Quantity change").fill("-2");
  await page.getByLabel("Adjustment reason").selectOption("other");
  const saveAdjustment = page.getByRole("button", { name: "Record stock adjustment" });
  const feedback = page.locator("form").filter({ has: saveAdjustment }).getByRole("alert");
  await saveAdjustment.click();
  await expect(feedback).toContainText("A note is required for Other");
  await page.getByLabel("Quantity change").fill("-2");
  await page.getByLabel("Adjustment reason").selectOption("damaged");
  await page.getByLabel("Adjustment note").fill("Two damaged units in the test delivery");
  await saveAdjustment.click();
  await expect(page.getByText("Stock adjustment recorded.", { exact: true })).toBeVisible();
  const adjustment = ledger.getByRole("row").filter({ hasText: "Two damaged units" });
  await expect(adjustment).toContainText("Damaged");
  await expect(adjustment).toContainText("-2");
  await expect(adjustment).toContainText(staff.id);
  await page.getByLabel("Quantity change").fill("-7");
  await page.getByLabel("Adjustment reason").selectOption("count_correction");
  await saveAdjustment.click();
  await expect(feedback).toContainText("not enough available units");

  await page.goto(`/admin/catalogue/${id}`);
  await expect(page.getByText("Latest costed receipt", { exact: true })).toBeVisible();
  await expect(page.getByText("£3.50", { exact: true })).toBeVisible();
  await expect(page.getByText(/below landed cost/i)).toHaveCount(0);
  await page.getByText("Correct latest receipt cost", { exact: true }).click();
  await page.getByLabel("Landed unit cost (£)", { exact: true }).fill("3.70");
  await page.getByRole("button", { name: "Save receipt cost correction" }).click();
  await expect(page.getByText("Receipt cost correction saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("£3.70", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View stock and receipts" }).click();
  await expect(page.getByRole("table", { name: "Movement ledger" }).getByRole("row")).toHaveCount(3);
  await expect(ledger.getByRole("row").filter({ hasText: "£3.70 landed" })).toContainText("+8");
  expect((await db.from("variants").select("stock_on_hand,stock_reserved").eq("id", id).single()).data)
    .toEqual({ stock_on_hand: 6, stock_reserved: 0 });
});

test("finance can correct an estimate; warehouse-only staff cannot see cost fields or receipt costs", async ({ page, browser, baseURL }) => {
  const { id, sku } = await createStockVariant();
  await setVerifiedStaffSession(page, await createLocalAdminUser("finance"), baseURL);
  await page.goto(`/admin/catalogue/${id}`);
  await expect(page.locator(".admin-location")).toHaveText("Admin");
  await expect(page.getByText(sku, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Selling prices" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save selling data" })).toHaveCount(0);
  await page.getByLabel("Supplier unit price", { exact: true }).fill("6.10");
  await page.getByLabel("Supplier currency", { exact: true }).selectOption("USD");
  await page.getByLabel("Landed unit cost (£)", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save cost estimate" }).click();
  await expect(page.getByText("Cost estimate saved.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Supplier currency", { exact: true })).toHaveValue("USD");
  await page.getByLabel("Landed unit cost (£)", { exact: true }).fill("4.75");
  await page.getByRole("button", { name: "Save cost estimate" }).click();
  await expect(page.getByText("£4.75", { exact: true })).toBeVisible();

  const warehouse = await browser.newPage({ baseURL });
  try {
    await setVerifiedStaffSession(warehouse, await createLocalAdminUser("warehouse"), baseURL);
    await warehouse.goto(`/admin/catalogue/${id}`);
    await expect(warehouse).toHaveURL("/admin");
    await warehouse.goto(`/admin/stock/${id}`);
    await expect(warehouse.getByText("Add receipt costs (optional)")).toHaveCount(0);
    await expect(warehouse.getByText("Receipt cost per blade")).toHaveCount(0);
    expect(await warehouse.content()).not.toContain("landed_unit_pence");
  } finally {
    await warehouse.close();
  }
});
