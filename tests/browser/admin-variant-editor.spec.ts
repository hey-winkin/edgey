import { randomUUID } from "node:crypto";
import { expect, test as base, type Locator } from "@playwright/test";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { connectAccountDb } from "../helpers/account-fixture";
import { setVerifiedStaffSession } from "./admin-fixtures";

const test = base.extend<{
  editorFixture: { id: string; siblingId: string; path: string; db: Awaited<ReturnType<typeof connectAccountDb>> };
}>({
  editorFixture: async ({}, run) => {
    const db = await connectAccountDb();
    const familyId = randomUUID();
    const id = randomUUID();
    const siblingId = randomUUID();
    const code = `EDITOR-${familyId.slice(0, 8)}`;
    try {
      await db.query(`
        insert into public.products (id, family_code, slug, name, tool_category, description)
        values ($1, $2, lower($2), 'Editor test blades', 'drag', 'A local editor fixture.')
      `, [familyId, code]);
      await db.query(`
        insert into public.variants (id, product_id, sku, option_label, price_1_4_pence, price_5_9_pence, price_10_plus_pence)
        values ($1, $3, $4 || '-A', 'Test option A', 2350, 2100, 1850),
          ($2, $3, $4 || '-B', 'Test option B', 2350, 2100, 1850)
      `, [id, siblingId, familyId, code]);
      await run({ id, siblingId, path: `/admin/catalogue/${id}`, db });
    } finally {
      try {
        await db.query("delete from public.staff_variant_cost_audit where variant_id = $1", [id]);
        await db.query("delete from public.staff_variant_costs where variant_id = $1", [id]);
        await db.query("delete from public.staff_receipt_costs where variant_id = $1", [id]);
        await db.query("delete from public.stock_movements where variant_id = $1", [id]);
        await db.query("delete from private.variant_price_changes where variant_id in ($1, $2)", [id, siblingId]);
        await db.query("delete from public.variants where product_id = $1", [familyId]);
        await db.query("delete from public.products where id = $1", [familyId]);
      } finally {
        await db.end();
      }
    }
  },
});

async function createReceiptCost({ db, id }: { db: Awaited<ReturnType<typeof connectAccountDb>>; id: string }, staffId: string) {
  await db.query(`
    with movement as (
      insert into public.stock_movements (kind, operation_key, variant_id, actor_id, on_hand_delta, reserved_delta)
      values ('receive', 'editor-receipt:' || $1::uuid::text, $1, $2, 1, 0) returning id
    )
    insert into public.staff_receipt_costs (
      stock_movement_id, variant_id, received_quantity, supplier_unit_minor, currency, landed_unit_pence, actor_id, recorded_at
    )
    select id, $1, 1, 1600, 'GBP', 1750, $2, now() from movement
  `, [id, staffId]);
}

async function expectReachableSave(save: Locator) {
  await expect(save).toBeInViewport();
  expect(await save.evaluate((button) => {
    const { left, top, width, height } = button.getBoundingClientRect();
    const mastheadBottom = document.querySelector(".staff-mast")?.getBoundingClientRect().bottom ?? 0;
    return top >= mastheadBottom && button.contains(document.elementFromPoint(left + width / 2, top + height / 2));
  })).toBe(true);
}

test("native section links and a reachable save separate family from SKU at 320 px without JavaScript", async ({ browser, baseURL, editorFixture }) => {
  const { id, siblingId, path, db } = editorFixture;
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 720 } });
  try {
    const page = await context.newPage();
    await setVerifiedStaffSession(page, await createLocalAdminUser("catalogue"), baseURL);
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Variant editor sections" });
    await nav.getByRole("link", { name: "Specifications & materials" }).press("Enter");
    await expect(page).toHaveURL(/#specifications$/);
    await expect(page.locator("#specifications")).toBeFocused();
    await expect(page.getByRole("heading", { name: "Specifications & materials" })).toBeInViewport();
    expect(await page.locator("#specifications").evaluate((section) =>
      section.getBoundingClientRect().top >= document.querySelector("#variant-selling-data")!.getBoundingClientRect().bottom,
    )).toBe(true);
    await page.getByLabel("Supplier part number").fill("EDITOR-A-TEST");
    await nav.getByRole("link", { name: "Family details" }).click();
    await expect(page).toHaveURL(/#family$/);
    await expect(page.getByText("Changes here apply to every SKU in this family.")).toBeInViewport();
    await page.getByLabel("Family name").fill("Renamed editor test blades");
    const save = page.getByRole("button", { name: "Save selling data" });
    await expectReachableSave(save);
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "Selling data saved." })).toBeVisible();
    const { rows } = await db.query(`
      select variants.id, products.name, variants.supplier_part_number
      from public.variants join public.products on products.id = variants.product_id
      where variants.id in ($1, $2)
    `, [id, siblingId]);
    expect(rows).toEqual(expect.arrayContaining([
      { id, name: "Renamed editor test blades", supplier_part_number: "EDITOR-A-TEST" },
      { id: siblingId, name: "Renamed editor test blades", supplier_part_number: null },
    ]));
  } finally {
    await context.close();
  }
});

test("live margins, unsaved guard and validation preserve independent selling and cost drafts", async ({ page, baseURL, editorFixture }) => {
  const { id, path, db } = editorFixture;
  await setVerifiedStaffSession(page, await createLocalAdminUser("catalogue"), baseURL);
  await page.goto(path);
  const nav = page.getByRole("navigation", { name: "Variant editor sections" });
  const prices = page.getByRole("region", { name: "Selling prices" });
  const cost = page.getByRole("region", { name: "Supplier cost" });
  const firstPrice = prices.getByLabel("1–4 blades (£ ex VAT)");
  const secondPrice = prices.getByLabel("5–9 blades (£ ex VAT)");
  const landed = cost.getByLabel("Landed unit cost (£)", { exact: true });
  const save = page.getByRole("button", { name: "Save selling data" });
  const sellingForm = page.locator("#variant-selling-data");
  await expect(prices.getByText("Cost missing — margin isn’t available.")).toBeVisible();
  await nav.getByRole("link", { name: "Pricing & costs" }).click();
  await expect(page).toHaveURL(/#pricing$/);
  await landed.fill("20");
  for (const margin of ["£3.50 (14.9%)", "£1.00 (4.8%)", "-£1.50 (-8.1%)"]) {
    await expect(prices.getByText(`Margin ex VAT: ${margin}`, { exact: false })).toBeVisible();
  }
  await expect(prices.getByText("Below landed cost")).toBeVisible();
  await firstPrice.fill("25");
  await expect(prices.getByText("Margin ex VAT: £5.00 (20.0%)")).toBeVisible();
  await expect(prices.getByText("£30.00 inc VAT (20%)")).toBeVisible();
  await expect(sellingForm.getByText("Unsaved selling changes", { exact: true })).toBeVisible();
  await expect(cost.getByText("Unsaved cost changes", { exact: true })).toBeVisible();
  await landed.fill("20.001");
  await expect(prices.getByText("Enter a valid landed cost to preview margin.")).toBeVisible();
  await expect(prices.getByText(/Margin ex VAT/)).toHaveCount(0);
  await landed.fill("0");
  await expect(prices.getByText("Unsaved landed cost · £0.00 per blade")).toBeVisible();
  await expect(prices.getByText(/Margin ex VAT: .*\(100\.0%\)/)).toHaveCount(3);
  await expect(prices.getByText("Below landed cost")).toHaveCount(0);
  await landed.fill("20");
  await nav.getByRole("link", { name: "Specifications & materials" }).click();
  await expect(page).toHaveURL(/#specifications$/);
  await expectReachableSave(save);

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("unsaved changes will be lost");
    await dialog.dismiss();
  });
  await page.getByRole("main").getByRole("link", { name: "Products and prices", exact: true }).click();
  await expect(page).toHaveURL(/#specifications$/);
  await expect(firstPrice).toHaveValue("25");

  await cost.getByLabel("Supplier unit price", { exact: true }).fill("16");
  await cost.getByLabel("Supplier currency", { exact: true }).selectOption("GBP");
  await cost.getByRole("button", { name: "Save cost estimate" }).click();
  await expect(cost.getByText("Cost estimate saved.", { exact: true })).toBeVisible();
  await expect(prices.getByText("Variant estimate · £20.00 per blade")).toBeVisible();
  await landed.clear();
  await expect(prices.getByText("Cost missing — margin isn’t available.")).toBeVisible();
  await expect(prices.getByText(/Margin ex VAT/)).toHaveCount(0);
  await landed.fill("20.00");
  await expect(cost.getByText("Unsaved cost changes", { exact: true })).toHaveCount(0);
  await expect(sellingForm.getByText("Unsaved selling changes", { exact: true })).toBeVisible();
  await expect(firstPrice).toHaveValue("25");

  await secondPrice.fill("30");
  await save.click();
  await expect(sellingForm.getByRole("alert")).toContainText("The unit price must stay the same or decrease");
  await expect(secondPrice).toHaveValue("30");
  await expect(sellingForm.getByText("Unsaved selling changes", { exact: true })).toBeVisible();
  await secondPrice.fill("21");
  await save.click();
  await expect(sellingForm.getByText("Selling data saved.", { exact: true })).toBeVisible();
  await expect(sellingForm.getByText("Unsaved selling changes", { exact: true })).toHaveCount(0);
  expect((await db.query("select price_1_4_pence from public.variants where id = $1", [id])).rows)
    .toEqual([{ price_1_4_pence: 2500 }]);
  await firstPrice.fill("24.50");
  await expect(sellingForm.getByText("Unsaved selling changes", { exact: true })).toBeVisible();
  await save.click();
  await expect.poll(async () => (await db.query("select price_1_4_pence from public.variants where id = $1", [id])).rows)
    .toEqual([{ price_1_4_pence: 2450 }]);
  await expect(sellingForm.getByText("Unsaved selling changes", { exact: true })).toHaveCount(0);
});

test("saving cost does not rebase an older selling draft onto another editor's changes", async ({ page, baseURL, editorFixture }) => {
  const { id, path, db } = editorFixture;
  await setVerifiedStaffSession(page, await createLocalAdminUser("catalogue"), baseURL);
  await page.goto(path);
  const firstPrice = page.getByLabel("1–4 blades (£ ex VAT)");
  await firstPrice.fill("25");
  await db.query("update public.variants set price_1_4_pence = 2600 where id = $1", [id]);
  await db.query("update public.products set name = 'Concurrent family edit' where id = (select product_id from public.variants where id = $1)", [id]);

  const cost = page.getByRole("region", { name: "Supplier cost" });
  await cost.getByLabel("Supplier unit price", { exact: true }).fill("16");
  await cost.getByLabel("Supplier currency", { exact: true }).selectOption("GBP");
  await cost.getByLabel("Landed unit cost (£)", { exact: true }).fill("20");
  await cost.getByRole("button", { name: "Save cost estimate" }).click();
  await expect(cost.getByText("Cost estimate saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Concurrent family edit" })).toBeVisible();
  await expect(firstPrice).toHaveValue("25");
  await expect(page.getByLabel("Family name")).toHaveValue("Editor test blades");

  const saveSelling = page.getByRole("button", { name: "Save selling data" });
  await saveSelling.click();
  await expect(page.locator("form").filter({ has: saveSelling }).getByRole("alert"))
    .toContainText("This record changed since you opened it");
  const { rows } = await db.query(`
    select products.name, variants.price_1_4_pence
    from public.variants join public.products on products.id = variants.product_id
    where variants.id = $1
  `, [id]);
  expect(rows).toEqual([{ name: "Concurrent family edit", price_1_4_pence: 2600 }]);
});

test("a selling save does not rebind an older receipt correction to the latest cost version", async ({ page, baseURL, editorFixture }) => {
  const { id, path, db } = editorFixture;
  const staff = await createLocalAdminUser("catalogue");
  await createReceiptCost(editorFixture, staff.id);
  await setVerifiedStaffSession(page, staff, baseURL);
  await page.goto(path);
  const cost = page.getByRole("region", { name: "Supplier cost" });
  await cost.getByText("Correct latest receipt cost", { exact: true }).click();
  const landed = cost.getByLabel("Landed unit cost (£)", { exact: true });
  await landed.fill("18");
  await db.query(`
    insert into public.staff_variant_cost_audit (variant_id, stock_movement_id, old_cost, new_cost, actor_id, recorded_at)
    select variant_id, stock_movement_id, '{"landed_unit_pence":1750}', '{"landed_unit_pence":1900}', $2, clock_timestamp()
    from public.staff_receipt_costs where variant_id = $1
  `, [id, staff.id]);

  await page.getByLabel("1–4 blades (£ ex VAT)").fill("25");
  await page.getByRole("button", { name: "Save selling data" }).click();
  await expect(page.getByText("Selling data saved.", { exact: true })).toBeVisible();
  await expect(cost.getByText("£19.00", { exact: true })).toBeVisible();
  await expect(landed).toHaveValue("18");
  await cost.getByRole("button", { name: "Save receipt cost correction" }).click();
  await expect(cost.getByRole("alert")).toContainText("The current cost or receipt changed");
  expect((await db.query("select landed_unit_pence from public.staff_effective_receipt_costs where variant_id = $1", [id])).rows)
    .toEqual([{ landed_unit_pence: 1900 }]);
});

test("the first costed receipt does not replace an open estimate draft", async ({ page, baseURL, editorFixture }) => {
  const { path } = editorFixture;
  const staff = await createLocalAdminUser("catalogue");
  await setVerifiedStaffSession(page, staff, baseURL);
  await page.goto(path);
  const cost = page.getByRole("region", { name: "Supplier cost" });
  const landed = cost.getByLabel("Landed unit cost (£)", { exact: true });
  await cost.getByLabel("Supplier unit price", { exact: true }).fill("16");
  await cost.getByLabel("Supplier currency", { exact: true }).selectOption("GBP");
  await landed.fill("18");
  await createReceiptCost(editorFixture, staff.id);
  await page.getByLabel("1–4 blades (£ ex VAT)").fill("25");
  await page.getByRole("button", { name: "Save selling data" }).click();
  await expect(page.getByText("Selling data saved.", { exact: true })).toBeVisible();
  await expect(cost.getByText("£17.50", { exact: true })).toBeVisible();
  await expect(landed).toBeVisible();
  await expect(landed).toHaveValue("18");
  await expect(cost.getByText("Unsaved cost changes", { exact: true })).toBeVisible();
  await cost.getByRole("button", { name: "Save cost estimate" }).click();
  await expect(cost.getByRole("alert")).toContainText("The current cost or receipt changed");
});

test("rejection explains the storefront consequence and refuses unchecked confirmation without JavaScript", async ({ browser, baseURL, editorFixture }) => {
  const { id, path, db } = editorFixture;
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await setVerifiedStaffSession(page, await createLocalAdminUser("catalogue"), baseURL);
    await page.goto(path);
    const submit = page.getByRole("button", { name: "Record variant review" });
    const review = page.locator("form").filter({ has: submit });
    const decision = review.getByLabel("Review decision");
    const confirm = review.getByRole("checkbox", { name: "I confirm this rejection" });
    await decision.selectOption("approve");
    await expect(confirm).not.toBeVisible();
    await decision.selectOption("reject");
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAccessibleDescription(/Rejecting a published SKU returns it to draft/);
    await review.getByLabel("Evidence source").fill("Local fixture");
    await review.getByLabel("Evidence note").fill("Test review decision only.");
    await submit.click();
    await expect(review.getByRole("alert")).toContainText("Confirm the consequence before recording a rejection.");
    expect((await db.query("select rejected_at from public.variants where id = $1", [id])).rows)
      .toEqual([{ rejected_at: null }]);

    await decision.selectOption("reject");
    await review.getByLabel("Evidence source").fill("Local fixture");
    await review.getByLabel("Evidence note").fill("Test review decision only.");
    await confirm.check();
    await submit.click();
    await expect(review.getByRole("status")).toHaveText("Rejection recorded.");
    expect((await db.query("select rejected_at from public.variants where id = $1", [id])).rows)
      .toEqual([{ rejected_at: expect.any(Date) }]);
  } finally {
    await context.close();
  }
});

test("review retains evidence after refusal and approval refreshes a clean selling snapshot", async ({ page, baseURL, editorFixture }) => {
  const { id, path, db } = editorFixture;
  await setVerifiedStaffSession(page, await createLocalAdminUser("catalogue"), baseURL);
  await page.goto(path);
  const review = page.locator("form").filter({ has: page.getByRole("button", { name: "Record variant review" }) });
  const decision = review.getByLabel("Review decision");
  const source = review.getByLabel("Evidence source");
  const note = review.getByLabel("Evidence note");
  await decision.selectOption("reject");
  await source.fill("Hydrated review fixture");
  await note.fill("Synthetic evidence for the editor test.");
  await review.getByRole("button", { name: "Record variant review" }).click();
  await expect(review.getByRole("alert")).toHaveText("Confirm the consequence before recording a rejection.");
  await expect(decision).toHaveValue("reject");
  await expect(source).toHaveValue("Hydrated review fixture");
  await expect(note).toHaveValue("Synthetic evidence for the editor test.");

  await decision.selectOption("approve");
  await review.getByRole("button", { name: "Record variant review" }).click();
  await expect(review.getByRole("status")).toHaveText("Approval recorded.");
  await page.getByLabel("1–4 blades (£ ex VAT)").fill("25");
  const sellingForm = page.locator("#variant-selling-data");
  await sellingForm.getByRole("button", { name: "Save selling data" }).click();
  await expect(sellingForm.getByText("Selling data saved.", { exact: true })).toBeVisible();
  expect((await db.query("select price_1_4_pence, approved_at from public.variants where id = $1", [id])).rows)
    .toEqual([{ price_1_4_pence: 2500, approved_at: expect.any(Date) }]);
});

test("finance previews margin for read-only selling prices but warehouse cannot open the cost surface", async ({ page, browser, baseURL, editorFixture }) => {
  const { db, id, path } = editorFixture;
  await setVerifiedStaffSession(page, await createLocalAdminUser("finance"), baseURL);
  await page.goto(path);
  const prices = page.getByRole("region", { name: "Selling prices" });
  await expect(prices.getByText("£23.50 ex VAT")).toBeVisible();
  await expect(prices.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save selling data" })).toHaveCount(0);
  const cost = page.getByRole("region", { name: "Supplier cost" });
  await cost.getByLabel("Landed unit cost (£)", { exact: true }).fill("20");
  await expect(prices.getByText(/Margin ex VAT:/)).toHaveCount(3);
  await db.query("update public.variants set price_1_4_pence = 2500 where id = $1", [id]);
  await cost.getByLabel("Supplier unit price", { exact: true }).fill("16");
  await cost.getByLabel("Supplier currency", { exact: true }).selectOption("GBP");
  await cost.getByRole("button", { name: "Save cost estimate" }).click();
  await expect(cost.getByText("Cost estimate saved.", { exact: true })).toBeVisible();
  await expect(prices.getByText("£25.00 ex VAT")).toBeVisible();
  await expect(prices.getByText("Margin ex VAT: £5.00 (20.0%)")).toBeVisible();

  const warehouse = await browser.newPage({ baseURL });
  try {
    await setVerifiedStaffSession(warehouse, await createLocalAdminUser("warehouse"), baseURL);
    await warehouse.goto(path);
    await expect(warehouse).toHaveURL("/admin");
    await expect(warehouse.getByRole("region", { name: "Supplier cost" })).toHaveCount(0);
  } finally {
    await warehouse.close();
  }
});
