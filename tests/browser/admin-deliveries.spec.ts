import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { openStaffMenu } from "../helpers/navigation";
import { saveThemeBeforeLoad, scanAccessibility, themes } from "../helpers/accessibility";
import { connectAccountDb } from "../helpers/account-fixture";
import { setVerifiedStaffSession } from "./admin-fixtures";

test.use({ locale: "en-GB" });

async function deliveryFixture() {
  const db = localAdminClient();
  const key = randomUUID().slice(0, 6).toUpperCase();
  const blades = [
    { name: "Sample straight blade", sku: `TEST-A-${key}`, id: randomUUID(), productId: randomUUID() },
    { name: "Sample round blade", sku: `TEST-B-${key}`, id: randomUUID(), productId: randomUUID() },
    { name: "Sample narrow blade", sku: `TEST-C-${key}`, id: randomUUID(), productId: randomUUID() },
  ] as const;
  const makerRef = `TEST-MAKER-${key}`;
  const ambiguousRef = `TEST-SHARED-${key}`;
  const sql = await connectAccountDb();
  try {
    for (const { id, sku, name, productId } of blades) {
      await sql.query("insert into public.products (id, family_code, slug, name, tool_category) values ($1, $2, lower($2), $3, 'oscillating')",
        [productId, sku, name]);
      await sql.query("insert into public.variants (id, sku, product_id) values ($1, $2, $3)", [id, sku, productId]);
    }
    await sql.query(`
      insert into public.compatibility (variant_id, code, code_kind)
      values ($1, $2, 'item_number'), ($1, $3, 'model'), ($4, $3, 'model')
    `, [blades[1].id, makerRef, ambiguousRef, blades[2].id]);
  } finally {
    await sql.end();
  }
  return { db, blades, makerRef, ambiguousRef, reference: `Test delivery ${key}` };
}

async function costedWarehouseUser() {
  const staff = await createLocalAdminUser("warehouse");
  const { error } = await localAdminClient().from("staff_members").insert({ user_id: staff.id, role: "finance" });
  if (error) throw error;
  return staff;
}

async function pasteLines(page: Page, input: string) {
  await page.getByText("Import lines", { exact: true }).click();
  await page.getByText("Paste table", { exact: true }).click();
  await page.getByLabel("Spreadsheet rows").fill(input);
  await page.getByRole("button", { name: "Add imported lines" }).click();
}

test("paste preview flags bad matches and quantities without moving stock until review is confirmed", async ({ page, baseURL }) => {
  const { blades: [first, second, third], makerRef, ambiguousRef, reference, db } = await deliveryFixture();
  await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
  await page.goto("/admin/stock");
  await page.getByRole("link", { name: "Receive a delivery", exact: true }).click();
  await page.getByLabel("Delivery reference").fill(reference);
  await page.getByLabel("Delivery note (optional)").fill("Fictional delivery for testing");
  await pasteLines(page, `code\tquantity\tunit cost\n${first.sku}\t10\t1.01\n${makerRef}\t4\t\n${ambiguousRef}\t3\t\nTEST-NOT-FOUND\t2\t\n${second.sku}\t0\t`);
  await expect(page.getByLabel("Blade code for line 1", { exact: true })).toHaveValue(first.sku);
  await expect(page.getByText(first.name, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/multiple matches/i).first()).toBeVisible();
  await expect(page.getByText(/unknown code|no blade found|no match/i).first()).toBeVisible();
  await expect(page.getByText(/same blade as line 2/i)).toBeVisible();
  await expect(page.getByText(/whole number from 1 to/i)).toBeVisible();
  await page.getByRole("button", { name: "Remove line 5" }).click();
  await page.getByRole("button", { name: "Remove line 4" }).click();
  await page.getByLabel("Blade code for line 3").fill(third.sku);
  await page.getByLabel("Quantity for line 3").fill("3");
  await expect(page.getByText(third.name, { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Review delivery" }).click();
  await expect(page.getByRole("heading", { name: "Review delivery", exact: true })).toBeFocused();
  const stock = () => db.from("variants").select("sku,stock_on_hand,publication_status").in("id", [first.id, second.id, third.id]).order("sku");
  expect((await stock()).data?.map((row) => row.stock_on_hand)).toEqual([0, 0, 0]);
  await page.getByRole("button", { name: "Back to edit" }).click();
  await page.getByLabel("Quantity for line 1").fill("11");
  await page.getByRole("button", { name: "Review delivery" }).click();
  await page.getByRole("button", { name: "Receive stock", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible();
  await expect(page.getByText("£1.01", { exact: true })).toBeVisible();
  await expect(page.getByText("Cost to be entered", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Fictional delivery for testing", { exact: false })).toBeVisible();
  expect((await stock()).data?.map((row) => [row.stock_on_hand, row.publication_status])).toEqual([[11, "draft"], [4, "draft"], [3, "draft"]]);
  await page.getByRole("link", { name: "Delivery history", exact: true }).click();
  await expect(page.getByRole("link", { name: reference })).toBeVisible();
  const previous = await page.getByRole("link", { name: reference }).getAttribute("href");
  await page.goto("/admin/stock/receive");
  await page.getByLabel("Delivery reference").fill(reference);
  await page.getByLabel("Blade code for line 1", { exact: true }).fill(first.sku);
  await page.getByLabel("Quantity for line 1", { exact: true }).fill("11");
  await page.getByRole("button", { name: "Review delivery" }).click();
  await expect(page.getByText(/this reference was already used/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /open previous delivery/i })).toHaveAttribute("href", previous!);
  expect((await stock()).data?.map((row) => row.stock_on_hand)).toEqual([11, 4, 3]);
});

test("warehouse can import CSV and receive without cost; finance can cost the same receipt later", async ({ page, browser, baseURL }) => {
  const { blades: [first, second], db, reference } = await deliveryFixture();
  await setVerifiedStaffSession(page, await createLocalAdminUser("warehouse"), baseURL);
  await page.goto("/admin");
  await (await openStaffMenu(page)).getByRole("link", { name: "Receive a delivery" }).click();
  const template = await page.request.get("/admin/stock/receive/template");
  expect(template.headers()["content-disposition"]).toContain("edgey-delivery-template.csv");
  expect(await template.text()).toBe("code,quantity\r\n");
  await page.getByLabel("Delivery reference").fill(reference);
  const code = page.getByLabel("Blade code for line 1", { exact: true });
  await code.fill(first.sku);
  await code.press("Enter");
  const quantity = page.getByLabel("Quantity for line 1", { exact: true });
  await expect(quantity).toBeFocused();
  await quantity.fill("8");
  await quantity.press("Enter");
  await expect(page.getByLabel("Blade code for line 2", { exact: true })).toBeFocused();
  await page.getByText("Import lines", { exact: true }).click();
  await page.getByText("Upload CSV", { exact: true }).click();
  const upload = page.getByLabel("CSV file");
  await upload.setInputFiles({ name: "large.csv", mimeType: "text/csv", buffer: Buffer.alloc(128 * 1024 + 1, "x") });
  await page.getByRole("button", { name: "Add imported lines" }).click();
  await expect(page.getByText(/128 KB/i).last()).toBeVisible();
  await upload.setInputFiles({
    name: "fictional.csv", mimeType: "text/csv",
    buffer: Buffer.from(`code,quantity,unit cost\r\n"${second.sku}","6","123.45"\r\n`),
  });
  await page.getByRole("button", { name: "Add imported lines" }).click();
  await expect(page.getByText(second.name, { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel("Unit cost (£) for line 1")).toHaveCount(0);
  await page.getByRole("button", { name: "Review delivery" }).click();
  await page.getByRole("button", { name: "Receive stock", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible();
  const record = page.url();
  await expect(page.getByText(/cost to be entered|123\.45|unit cost/i)).toHaveCount(0);

  const finance = await browser.newPage({ baseURL });
  try {
    await setVerifiedStaffSession(finance, await createLocalAdminUser("finance"), baseURL);
    await finance.goto("/admin");
    await (await openStaffMenu(finance)).getByRole("link", { name: "Delivery history" }).click();
    await finance.getByRole("link", { name: reference }).click();
    await expect(finance).toHaveURL(record);
    await expect(finance.getByText("Cost to be entered", { exact: true })).toHaveCount(2);
    const line = finance.getByRole("listitem").filter({ hasText: second.sku });
    await line.getByLabel(/unit cost/i).fill("£2.03");
    await line.getByRole("button", { name: "Save unit cost" }).click();
    await expect(line.getByText("£2.03", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(/cost to be entered|£2\.03|unit cost/i)).toHaveCount(0);
    const { data } = await db.from("variants").select("stock_on_hand").eq("id", second.id).single();
    expect(data?.stock_on_hand).toBe(6);
    await finance.goto("/admin/stock/receive");
    await expect(finance).toHaveURL("/admin");
  } finally {
    await finance.close();
  }
});

test("a lost response keeps the reviewed delivery locked and retrying does not add stock again", async ({ page, baseURL }) => {
  const { blades: [first], reference, db } = await deliveryFixture();
  await setVerifiedStaffSession(page, await createLocalAdminUser("warehouse"), baseURL);
  await page.goto("/admin/stock/receive");
  await page.getByLabel("Delivery reference").fill(reference);
  await page.getByLabel("Blade code for line 1", { exact: true }).fill(first.sku);
  await page.getByLabel("Quantity for line 1", { exact: true }).fill("9");
  await page.getByRole("button", { name: "Review delivery" }).click();
  await expect(page.getByRole("heading", { name: "Review delivery", exact: true })).toBeVisible();

  await page.route("**/admin/stock/receive", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch({ maxRetries: 0 });
    expect(response.ok()).toBe(true);
    await route.abort();
  }, { times: 1 });
  await page.getByRole("button", { name: "Receive stock", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry receiving stock" });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to edit" })).toHaveCount(0);
  const stock = () => db.from("variants").select("stock_on_hand").eq("id", first.id).single();
  expect((await stock()).data?.stock_on_hand).toBe(9);
  await retry.click();
  await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible();
  expect((await stock()).data?.stock_on_hand).toBe(9);
});

for (const theme of themes) {
  test(`receiving routes reflow in ${theme} across desktop and phone sizes`, async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const { blades: [first, second], makerRef, reference } = await deliveryFixture();
    await saveThemeBeforeLoad(page, theme);
    await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
    await page.goto("/admin/stock/receive");
    await page.getByLabel("Delivery reference").fill(reference);
    await pasteLines(page, `code,quantity,unit cost\n${first.sku},14,1.23\n${makerRef},8`);
    await expect(page.getByText(second.name, { exact: false }).first()).toBeVisible();
    const renders = process.env.EDGEY_DELIVERY_RENDERS;
    async function checkEverySize(step: string) {
      for (const viewport of [
        { width: 1440, height: 960 }, { width: 1280, height: 800 },
        { width: 390, height: 844 }, { width: 320, height: 800 },
      ]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), step).toBeLessThanOrEqual(viewport.width);
        if (step === "entry" && viewport.width === 1280) {
          const firstBlade = page.getByLabel("Blade code for line 1", { exact: true });
          expect(await firstBlade.evaluate((field) => field.getBoundingClientRect().bottom + window.scrollY))
            .toBeLessThanOrEqual(viewport.height);
        }
        if (viewport.width === 320 || viewport.width === 1440) await scanAccessibility(page, theme);
        if (renders) {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: join(renders, `${step}-${viewport.width}-${theme}.png`), fullPage: true, animations: "disabled" });
        }
      }
    }
    await checkEverySize("entry");
    await page.getByRole("button", { name: "Review delivery" }).click();
    await expect(page.getByRole("heading", { name: "Review delivery", exact: true })).toBeVisible();
    await checkEverySize("review");
    await page.getByRole("button", { name: "Receive stock", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: reference })).toBeVisible();
    await checkEverySize("record");
    await page.getByRole("link", { name: "Delivery history", exact: true }).click();
    await expect(page.getByRole("link", { name: reference })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    await scanAccessibility(page, theme);
  });
}
