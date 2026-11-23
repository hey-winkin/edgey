import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { signInStaff } from "../browser/admin-fixtures";
import { createAccountCatalogue } from "../helpers/account-fixture";
import { addBlade, capture, database, event, payByCard, review, sessionPath, visitSuccess } from "./storefront-fixtures";

test("costs stay out of buyer surfaces and retiring a SKU preserves its paid order", async ({ page, browser, baseURL, request }) => {
  const db = await database();
  const staffPage = await browser.newPage({ baseURL });
  try {
    const { available } = await createAccountCatalogue(db);
    const stockCostNote = `Staff cost fixture ${randomUUID()}`;
    const variantPath = `/admin/catalogue/${available.id}`;
    await signInStaff(staffPage, await createLocalAdminUser("catalogue"));
    await staffPage.goto(variantPath);
    await staffPage.getByLabel("Supplier unit price", { exact: true }).fill("29.41");
    await staffPage.getByLabel("Supplier currency", { exact: true }).selectOption("USD");
    await staffPage.getByLabel("Landed unit cost (£)", { exact: true }).fill("24.13");
    await staffPage.getByLabel("Cost note").fill(stockCostNote);
    await staffPage.getByRole("button", { name: "Save cost estimate" }).click();
    await expect(staffPage.locator("dd").filter({ hasText: stockCostNote })).toBeVisible();

    const privateContent = /supplier_unit_minor|landed_unit_pence|staff_current_variant_costs|24\.13|29\.41|Staff cost fixture/;
    await page.goto(`/blades?q=${available.sku}`);
    const result = page.locator(".cards").getByRole("link", { name: /Account test blades/ });
    await expect(result).toHaveAccessibleDescription(new RegExp(`^Exact match · ${available.sku} `));
    expect(await page.content()).not.toMatch(privateContent);
    await result.click();
    expect(await page.content()).not.toMatch(privateContent);
    await addBlade(page);
    await review(page);
    expect(await page.content()).not.toMatch(privateContent);
    let checkoutBody: string | undefined;
    await page.route(`**${sessionPath}`, async (route) => {
      const response = await route.fetch();
      checkoutBody = await response.text();
      await route.fulfill({ response });
    }, { times: 1 });
    const session = await payByCard(page);
    expect(checkoutBody).toEqual(expect.any(String));
    expect(checkoutBody).not.toMatch(privateContent);
    expect(JSON.stringify(session)).not.toMatch(privateContent);
    await capture(session.id);
    await event(request, "checkout.session.completed", session.id);

    await staffPage.getByText("Retire this variant", { exact: true }).click();
    const retire = staffPage.getByRole("button", { name: "Confirm retire this variant" });
    await retire.evaluate((button: HTMLButtonElement) => { button.formNoValidate = true; });
    await retire.click();
    await expect(staffPage.getByRole("alert").filter({ hasText: "Confirm retirement before continuing." })).toBeVisible();
    expect((await db.query("select publication_status from public.variants where id = $1", [available.id])).rows)
      .toEqual([{ publication_status: "published" }]);
    await staffPage.getByRole("checkbox", { name: /permanently retire/i }).check();
    await retire.click();
    await expect(staffPage.getByText("Archived", { exact: true })).toBeVisible();
    await page.goto(`/blades?q=${available.sku}`);
    await expect(result).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ask us to match this blade" })).toBeVisible();
    await visitSuccess(page, session);
    expect(await page.content()).not.toMatch(privateContent);
    expect((await db.query("select sku, unit_price_pence from public.order_items where order_id = $1",
      [session.client_reference_id])).rows).toEqual([{ sku: available.sku, unit_price_pence: 2350 }]);
  } finally {
    await staffPage.close();
    await db.end();
  }
});
