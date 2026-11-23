import { openStaffMenu } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb } from "../helpers/account-fixture";
import { signInStaff } from "./admin-fixtures";

test("a catalogue operator can save specifications before setting a draft's prices", async ({ page }) => {
  const db = await connectAccountDb();
  const familyId = randomUUID();
  const variantId = randomUUID();
  const fixtureCode = `TEST-BLADES-${familyId}`;
  try {
    await db.query(`
      with family as (
        insert into public.products (id, family_code, slug, name, tool_category, description)
        values ($1, $2, lower($2), 'Test blades', 'drag', 'Unpriced blade fixture.') returning id
      )
      insert into public.variants (id, product_id, sku) select $3, id, $2 from family
    `, [familyId, fixtureCode, variantId]);
    await signInStaff(page, await createLocalAdminUser("catalogue"));
    await page.goto(`/admin/catalogue/${variantId}`);
    const firstTier = page.getByLabel("1–4 blades (£ ex VAT)");
    await expect(firstTier).toHaveValue("");
    await firstTier.fill("21.50");
    await expect(page.getByText("£25.80 inc VAT (20%)")).toBeVisible();
    await page.getByRole("button", { name: "Save selling data" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter all three price tiers" })).toBeVisible();
    await firstTier.clear();
    const part = page.getByLabel("Supplier part number");
    await part.fill("TEST-UNPRICED-DRAFT");
    await page.getByRole("button", { name: "Save selling data" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Selling data saved." })).toBeVisible();
    await expect(firstTier).toHaveValue("");
    await page.reload();
    await expect(part).toHaveValue("TEST-UNPRICED-DRAFT");
    await expect(firstTier).toHaveValue("");

    await firstTier.fill("21.51");
    await page.getByLabel("5–9 blades (£ ex VAT)").fill("18.95");
    await page.getByLabel("10+ blades (£ ex VAT)").fill("16.5");
    for (const vatInclusive of ["£25.81", "£22.74", "£19.80"]) {
      await expect(page.getByText(`${vatInclusive} inc VAT (20%)`)).toBeVisible();
    }
    await page.getByRole("button", { name: "Save selling data" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Selling data saved." })).toBeVisible();
    expect((await db.query(`
      select price_1_4_pence, price_5_9_pence, price_10_plus_pence, publication_status
      from public.variants where id = $1
    `, [variantId])).rows).toEqual([{
      price_1_4_pence: 2151, price_5_9_pence: 1895, price_10_plus_pence: 1650, publication_status: "draft",
    }]);
  } finally {
    try {
      await db.query("delete from public.variants where id = $1", [variantId]);
      await db.query("delete from public.products where id = $1", [familyId]);
    } finally {
      await db.end();
    }
  }
});

test("a catalogue operator approves and publishes a draft for public search", async ({ page }) => {
  const staff = await createLocalAdminUser("catalogue");
  await signInStaff(page, staff);
  await (await openStaffMenu(page)).getByRole("link", { name: "Catalogue" }).click();
  await page.getByRole("link", { name: "EDG-Z11", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tight-corner drag blade" })).toBeVisible();
  const variantPath = new URL(page.url()).pathname;
  const db = localAdminClient();
  await expect(page.getByLabel("1–4 blades (£ ex VAT)")).toHaveValue("22.50");
  await expect(page.getByText("£27.00 inc VAT (20%)")).toBeVisible();

  await page.getByLabel("Supplier name").fill("Fixture Tooling");
  await page.getByLabel("Supplier part number").fill("FIXTURE-Z11");
  await page.getByRole("button", { name: "Save selling data" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Selling data saved." })).toBeVisible();

  const variantReview = page.getByRole("button", { name: "Record variant review" }).locator("xpath=ancestor::form");
  await variantReview.getByLabel("Review decision").selectOption("approve");
  await variantReview.getByLabel("Evidence source").fill("Local test packet");
  await variantReview.getByLabel("Evidence note").fill("Synthetic replacement configuration for browser tests only.");
  await variantReview.getByRole("button", { name: "Record variant review" }).click();
  await expect(variantReview.getByRole("status")).toHaveText("Approval recorded.");

  const mapping = page.locator("details").filter({ has: page.locator("summary").getByText("3910309", { exact: true }) });
  await mapping.locator("summary").click();
  await mapping.getByLabel("Review decision").selectOption("approve");
  await mapping.getByLabel("Evidence source").fill("Local OEM reference fixture");
  await mapping.getByLabel("Evidence note").fill("Synthetic OEM match for browser tests only.");
  await mapping.getByRole("button", { name: "Record review for 3910309" }).click();
  await expect(mapping.getByRole("status")).toHaveText("Approval recorded.");

  await page.getByRole("button", { name: "Publish variant", exact: true }).click();
  await expect(page.locator("summary").filter({ hasText: /^Unpublish variant$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm unpublish variant" })).not.toBeVisible();
  expect((await db.from("variants").select("publication_status").eq("sku", "EDG-Z11").single()).data?.publication_status).toBe("published");

  await page.goto("/blades?q=3910309");
  await expect(page.getByRole("link", { name: /EDG-Z11 Tight-corner drag blade/ }))
    .toHaveAccessibleDescription(/Exact match · 3910309/);
  await page.goto(variantPath);
  await page.locator("summary").filter({ hasText: /^Unpublish variant$/ }).click();
  const unpublish = page.getByRole("button", { name: "Confirm unpublish variant" });
  const confirm = page.getByRole("checkbox", { name: "I confirm this SKU should return to draft" });
  await unpublish.click();
  await expect(confirm).toBeFocused();
  await confirm.evaluate((checkbox) => checkbox.removeAttribute("required"));
  await unpublish.click();
  await expect(page.locator("form").filter({ has: unpublish }).getByRole("alert"))
    .toHaveText("Confirm that this SKU should return to draft.");
  expect((await db.from("variants").select("publication_status").eq("sku", "EDG-Z11").single()).data?.publication_status).toBe("published");
  await confirm.check();
  await unpublish.click();
  await expect(page.getByRole("button", { name: "Publish variant", exact: true })).toBeVisible();
  await page.goto("/blades?q=3910309");
  await expect(page.getByRole("link", { name: "Ask us to match this blade" })).toBeVisible();
});

test("warehouse cannot use a stale catalogue mutation form", async ({ browser, page, baseURL }) => {
  const db = localAdminClient();
  const sku = "EDG-HTR040";
  const before = await db.from("variants").select("id,supplier_part_number").eq("sku", sku).single();
  if (before.error) throw before.error;
  await signInStaff(page, await createLocalAdminUser("catalogue"));
  await page.goto(`/admin/catalogue/${before.data.id}`);
  await page.getByLabel("Supplier part number").fill("DENIED-STALE-FORM");

  const warehouse = await browser.newContext({ baseURL });
  try {
    await signInStaff(await warehouse.newPage(), await createLocalAdminUser("warehouse"));
    await page.context().clearCookies();
    await page.context().addCookies(await warehouse.cookies());
    await page.getByRole("button", { name: "Save selling data" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const after = await db.from("variants").select("id,supplier_part_number").eq("sku", sku).single();
    expect(after.data).toEqual(before.data);
  } finally {
    await warehouse.close();
  }
});
