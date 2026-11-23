import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { connectAccountDb } from "../helpers/account-fixture";
import { setVerifiedStaffSession } from "./admin-fixtures";

test("staff can search the catalogue and page through the filtered variant summaries", async ({ page, baseURL }) => {
  const db = await connectAccountDb();
  const id = randomUUID();
  const prefix = `ZZ-LIST-${id.slice(0, 8).toUpperCase()}`;
  const sku = (index: string) => `${prefix}-${index}`;
  const partCode = `OEM-${id.slice(0, 8)}`;
  const staff = await createLocalAdminUser("catalogue");
  try {
    await db.query(`
      insert into public.products (id, family_code, slug, name, tool_category)
      values ($1, $2, lower($2), 'Blade list fixture', 'drag')
    `, [id, prefix]);
    await db.query(`
      insert into public.variants (product_id, sku, option_label, stock_on_hand, stock_reserved,
        price_1_4_pence, price_5_9_pence, price_10_plus_pence, publication_status)
      select $1, $2 || '-' || lpad(n::text, 2, '0'), 'Standard', 12, 5,
        case when n <> 51 then 2100 end, case when n <> 51 then 1800 end, case when n <> 51 then 1500 end,
        case when n = 0 then 'archived'::public.publication_status else 'draft' end
      from generate_series(0, 52) as n
    `, [id, prefix]);
    await db.query(`
      insert into public.compatibility (variant_id, code, code_kind, brand)
      select id, $2 || substr(sku, length($3) + 1), 'item_number',
        case when sku = $3 || '-52' then 'summa' else 'zund' end
      from public.variants where product_id = $1
    `, [id, partCode, prefix]);
    await db.query(`
      insert into public.compatibility (variant_id, code, code_kind, brand)
      select id, $1 || '-01-b', 'alias', 'zund' from public.variants where sku = $2
    `, [partCode, sku("01")]);
    await db.query(`
      insert into public.staff_variant_costs (variant_id, supplier_unit_minor, currency, landed_unit_pence, actor_id, recorded_at)
      select id, 719, 'GBP', 987, $2, now() from public.variants where sku = $1
    `, [sku("51"), staff.id]);

    await setVerifiedStaffSession(page, staff, baseURL);
    await page.goto("/admin/catalogue");
    const filters = page.getByRole("search", { name: "Catalogue filters" });
    await filters.getByLabel("Search by code").fill(partCode.replace("-", "").toUpperCase());
    await filters.getByLabel("Status").selectOption("draft");
    await filters.getByLabel("Brand").selectOption("zund");
    await filters.getByRole("button", { name: "Apply filters" }).click();

    const table = page.getByRole("table", { name: "Catalogue variants" });
    const first = table.getByRole("row").filter({ hasText: sku("01") });
    await expect(table.getByRole("row")).toHaveCount(51);
    await expect(first).toHaveCount(1);
    for (const value of ["Blade list fixture", "Draft", "Needs review", "7", "£15.00", "Cost missing"]) {
      await expect(first.getByText(value, { exact: true })).toBeVisible();
    }
    for (const index of ["00", "51", "52"]) await expect(table.getByText(sku(index))).toHaveCount(0);

    await page.getByRole("link", { name: "Next page" }).click();
    await expect(table.getByRole("row")).toHaveCount(2);
    const last = table.getByRole("row").filter({ hasText: sku("51") });
    await expect(last.getByText("Not set")).toBeVisible();
    await expect(last.getByText("Cost missing")).toHaveCount(0);
    await expect(last).not.toContainText("£9.87");
    await expect(filters.getByLabel("Status")).toHaveValue("draft");
    await expect(filters.getByLabel("Brand")).toHaveValue("zund");
    await expect(page.getByRole("link", { name: "Next page" })).toHaveCount(0);
    await page.getByRole("link", { name: "Previous page" }).click();
    await expect(first).toBeVisible();

    await filters.getByLabel("Search by code").fill(sku("01").toLowerCase().replaceAll("-", " "));
    await filters.getByLabel("Brand").selectOption("summa");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("No catalogue variants match these filters.")).toBeVisible();
    await filters.getByLabel("Brand").selectOption("zund");
    await filters.getByRole("button", { name: "Apply filters" }).click();
    await expect(first).toBeVisible();

    const directory = process.env.EDGEY_CATALOGUE_LIST_RENDERS;
    const lightTheme = page.getByRole("switch", { name: "Light theme" });
    for (const theme of ["dark", "light"]) {
      if (theme === "light") {
        await lightTheme.click();
        await expect(lightTheme).toBeChecked();
      }
      for (const [width, height] of [[1440, 900], [1280, 800], [390, 844], [320, 800]] as const) {
        await page.setViewportSize({ width, height });
        await expect(first.getByText("Cost missing")).toBeInViewport();
        expect(await table.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
        expect(await first.getByText("£15.00", { exact: true }).evaluate((node) => node.getClientRects().length)).toBe(1);
        if (directory) await page.screenshot({ path: join(directory, `catalogue-list-${width}-${theme}.png`) });
      }
    }
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(filters.getByLabel("Search by code")).toHaveValue("");
    await expect(filters.getByLabel("Status")).toHaveValue("");
    await expect(filters.getByLabel("Brand")).toHaveValue("");
  } finally {
    try {
      await db.query(`delete from public.staff_variant_costs where variant_id in
        (select id from public.variants where product_id = $1)`, [id]);
      await db.query("delete from public.variants where product_id = $1", [id]);
      await db.query("delete from public.products where id = $1", [id]);
    } finally {
      await db.end();
    }
  }
});

test("catalogue staff can match private aliases without adding that access to finance", async ({ page, baseURL }) => {
  const db = await connectAccountDb();
  const id = randomUUID();
  const sku = `ZZ-LIST-${id.slice(0, 8).toUpperCase()}`;
  const publicCode = `OEM-${id.slice(0, 8)}`;
  const privateCode = `PRIVATE-${id.slice(0, 8)}`;
  try {
    await db.query(`
      with family as (
        insert into public.products (id, family_code, slug, name, tool_category)
        values ($1, $2, lower($2), 'Blade alias fixture', 'drag') returning id
      ), variant as (
        insert into public.variants (product_id, sku) select id, $2 from family returning id
      )
      insert into public.compatibility (variant_id, code, code_kind, is_private, verification_state, approved_at, evidence_source)
      select id, $3, 'item_number'::public.compatibility_code_kind, false,
        'approved'::public.verification_state, now(), 'Synthetic browser test' from variant
      union all
      select id, $4, 'alias'::public.compatibility_code_kind, true,
        'approved'::public.verification_state, now(), 'Synthetic browser test' from variant
    `, [id, sku, publicCode, privateCode]);

    const path = (code: string) => `/admin/catalogue?q=${code}`;
    const variant = page.getByRole("link", { name: sku, exact: true });
    await setVerifiedStaffSession(page, await createLocalAdminUser("catalogue"), baseURL);
    await page.goto(path(privateCode));
    await expect(variant).toBeVisible();
    await expect(page.getByRole("link", { name: "Add draft variant" })).toBeVisible();

    await page.context().clearCookies();
    await setVerifiedStaffSession(page, await createLocalAdminUser("finance"), baseURL);
    await page.goto(path(privateCode));
    await expect(page.getByText("No catalogue variants match these filters.")).toBeVisible();
    await expect(variant).toHaveCount(0);
    await page.goto(path(publicCode));
    await expect(variant).toBeVisible();
    await expect(page.getByText("Cost missing", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add draft variant" })).toHaveCount(0);
  } finally {
    try {
      await db.query("delete from public.variants where product_id = $1", [id]);
      await db.query("delete from public.products where id = $1", [id]);
    } finally {
      await db.end();
    }
  }
});
