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
  await page.getByLabel("Spreadsheet rows").fill(input);
  await page.getByRole("button", { name: "Add imported lines" }).click();
}

async function enterBeforeHydration(page: Page, enter: () => Promise<void>) {
  const gate = Promise.withResolvers<void>();
  let blocked = 0;
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, async (route) => {
    blocked++;
    await gate.promise;
    await route.continue();
  });
  try {
    await page.goto("/admin/stock/receive", { waitUntil: "commit" });
    await expect.poll(() => blocked).toBeGreaterThan(0);
    await enter();
  } finally {
    gate.resolve();
  }
  await page.waitForLoadState("load");
}

async function expectEnhancedKeyboardNavigation(page: Page) {
  await expect(page.getByText("Press Enter to move to the next field or line.", { exact: false })).toBeVisible();
  await page.getByLabel("Blade code for line 1").press("Enter");
  await expect(page.getByLabel("Quantity for line 1")).toBeFocused();
}

const testReceivedOn = "2026-10-05";

type ExpectedReceipt = {
  reference: string;
  receivedOn?: string;
  note: string;
  lines: { sku: string; quantity: number; costPence: number | null }[];
};

async function expectStoredReceipt(page: Page, { reference, receivedOn = testReceivedOn, note, lines }: ExpectedReceipt) {
  await expect(page.getByRole("heading", { level: 1, name: reference, exact: true })).toBeVisible();
  const deliveryId = new URL(page.url()).pathname.split("/").at(-1);
  const sql = await connectAccountDb();
  try {
    const headers = await sql.query("select reference, received_on::text, note from public.staff_deliveries where id = $1", [deliveryId]);
    const entries = await sql.query(`
      select l.sku, l.quantity, m.on_hand_delta, v.stock_on_hand, c.landed_unit_pence
      from public.staff_delivery_lines l
      join public.stock_movements m on m.id = l.stock_movement_id
      join public.variants v on v.id = l.variant_id
      left join public.staff_receipt_costs c on c.stock_movement_id = l.stock_movement_id
      where l.delivery_id = $1 order by l.position
    `, [deliveryId]);
    expect(headers.rows).toEqual([{ reference, received_on: receivedOn, note }]);
    expect(entries.rows).toEqual(lines.map(({ sku, quantity, costPence }) => ({
      sku, quantity, on_hand_delta: quantity, stock_on_hand: quantity, landed_unit_pence: costPence,
    })));
  } finally {
    await sql.end();
  }
}

test("manual fields entered before hydration survive review and receipt", async ({ page, baseURL }) => {
  const { blades: [first], reference } = await deliveryFixture();
  await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
  const note = "Fictional stock entered while scripts were delayed.";
  const fields = [
    ["Delivery reference", reference],
    ["Delivery note (optional)", note],
    ["Blade code for line 1", first.sku],
    ["Quantity for line 1", "17"],
    ["Unit cost (£) for line 1", "3.27"],
  ] as const;
  const date = page.getByLabel("Date received");
  let receivedOn = "";

  await enterBeforeHydration(page, async () => {
    const defaultDate = await date.inputValue();
    await date.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    receivedOn = await date.inputValue();
    expect(receivedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(receivedOn < defaultDate).toBe(true);
    for (const [label, value] of fields) {
      const field = page.getByLabel(label);
      await field.pressSequentially(value);
      await expect(field).toHaveValue(value);
      if (label === "Blade code for line 1") {
        await field.press("Enter");
        await expect(page.getByLabel("Quantity for line 1")).toBeFocused();
      } else if (label === "Quantity for line 1") {
        await field.press("Enter");
        await expect(page.getByLabel("Unit cost (£) for line 1")).toBeFocused();
      } else if (label === "Unit cost (£) for line 1") {
        await field.press("Enter");
        await expect(page.getByRole("button", { name: "Add line", exact: true })).toBeFocused();
      }
    }
  });

  await expectEnhancedKeyboardNavigation(page);
  await expect(date).toHaveValue(receivedOn);
  for (const [label, value] of fields) await expect(page.getByLabel(label)).toHaveValue(value);
  await page.getByRole("button", { name: "Review delivery" }).click();
  const review = page.getByRole("region", { name: "Review delivery" });
  await expect(review.getByText(reference, { exact: true })).toBeVisible();
  await expect(review.locator("time")).toHaveAttribute("datetime", receivedOn);
  await expect(review.getByText(note, { exact: true })).toBeVisible();
  const line = review.getByRole("listitem").filter({ hasText: first.sku });
  await expect(line.getByText(first.name, { exact: true })).toBeVisible();
  await expect(line.getByText("17", { exact: true })).toBeVisible();
  await expect(line.getByText("£3.27", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Receive stock", exact: true }).click();
  await expectStoredReceipt(page, { reference, receivedOn, note, lines: [{ sku: first.sku, quantity: 17, costPence: 327 }] });
});

test("review can submit natively while Next scripts are blocked", async ({ page, baseURL }) => {
  const { blades: [first], reference, db } = await deliveryFixture();
  await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
  const note = "Fictional stock reviewed before scripts arrived.";
  await enterBeforeHydration(page, async () => {
    await page.getByLabel("Delivery reference").fill(reference);
    await page.getByLabel("Date received").fill(testReceivedOn);
    await page.getByLabel("Delivery note (optional)").fill(note);
    await page.getByLabel("Blade code for line 1").fill(first.sku);
    await page.getByLabel("Quantity for line 1").fill("6");
    await page.getByLabel("Unit cost (£) for line 1").fill("1.20");
    const request = page.waitForRequest((request) => request.isNavigationRequest() && request.method() === "POST"
      && new URL(request.url()).pathname === "/admin/stock/receive");
    await page.getByRole("button", { name: "Review delivery" }).click();
    await request;
    const review = page.getByRole("region", { name: "Review delivery" });
    await expect(review.getByText(reference, { exact: true })).toBeVisible();
    await expect(review.locator("time")).toHaveAttribute("datetime", testReceivedOn);
    await expect(review.getByText(note, { exact: true })).toBeVisible();
    await expect(review.getByRole("listitem").filter({ hasText: first.sku }).getByText("£1.20", { exact: true })).toBeVisible();
    expect((await db.from("variants").select("stock_on_hand").eq("id", first.id).single()).data?.stock_on_hand).toBe(0);
  });
  await page.getByRole("button", { name: "Receive stock", exact: true }).click();
  await expectStoredReceipt(page, { reference, note, lines: [{ sku: first.sku, quantity: 6, costPence: 120 }] });
});

test("an edit to a prefilled note survives hydration after a native check", async ({ page, baseURL }) => {
  const { blades: [first], reference } = await deliveryFixture();
  await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
  const note = "Fictional parcel";
  const updated = `${note} with an extra carton`;
  const noteField = page.getByLabel("Delivery note (optional)");
  await enterBeforeHydration(page, async () => {
    await page.getByLabel("Delivery reference").fill(reference);
    await noteField.fill(note);
    await page.getByLabel("Blade code for line 1").fill(first.sku);
    await page.getByLabel("Quantity for line 1").fill("3");
    await page.getByRole("button", { name: "Check blade codes" }).click();
    await expect(page.getByText(first.name, { exact: true })).toBeVisible();
    await expect(noteField).toHaveValue(note);
    await noteField.press("End");
    await noteField.pressSequentially(" with an extra carton");
    await expect(noteField).toHaveValue(updated);
  });
  await expectEnhancedKeyboardNavigation(page);
  await expect(noteField).toHaveValue(updated);
  await page.getByRole("button", { name: "Review delivery" }).click();
  await expect(page.getByText(updated, { exact: true })).toBeVisible();
});

for (const method of ["spreadsheet rows", "CSV upload"] as const) {
  test(`${method} entered before hydration can be imported and received`, async ({ page, baseURL }) => {
    const { blades: [first], reference } = await deliveryFixture();
    await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
    const note = "Fictional imported stock.";
    const spreadsheet = page.getByLabel("Spreadsheet rows");
    const upload = page.getByLabel("CSV file");
    const csv = `code,quantity,unit cost\n${first.sku},12,1.23`;
    const filename = "early-selection.csv";
    const expectSourceToSurvive = async () => {
      if (method === "spreadsheet rows") await expect(spreadsheet).toHaveValue(csv);
      else await expect.poll(() => upload.evaluate((field: HTMLInputElement) => field.files?.[0]?.name)).toBe(filename);
    };
    await enterBeforeHydration(page, async () => {
      await page.getByLabel("Delivery reference").fill(reference);
      await page.getByLabel("Date received").fill(testReceivedOn);
      await page.getByLabel("Delivery note (optional)").fill(note);
      await page.getByText("Import lines", { exact: true }).click();
      if (method === "spreadsheet rows") {
        await spreadsheet.fill(csv);
      } else {
        await upload.setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from(csv) });
      }
      await expectSourceToSurvive();
    });

    await expectEnhancedKeyboardNavigation(page);
    await expect(page.getByRole("button", { name: "Add imported lines" })).toBeVisible();
    await expectSourceToSurvive();
    await page.getByRole("button", { name: "Review delivery" }).click();
    await expect(page.getByRole("alert").filter({ hasText: method === "CSV upload" ? "Add the CSV lines" : "Add the pasted lines" })).toBeVisible();
    await expectSourceToSurvive();
    await page.getByRole("button", { name: "Add imported lines" }).click();
    await expect(page.getByLabel("Blade code for line 1")).toHaveValue(first.sku);
    await expect(page.getByLabel("Quantity for line 1")).toHaveValue("12");
    await expect(page.getByLabel("Unit cost (£) for line 1")).toHaveValue("1.23");
    await page.getByRole("button", { name: "Review delivery" }).click();
    await expect(page.getByRole("list", { name: "Reviewed delivery lines" })).toContainText(first.sku);
    await page.getByRole("button", { name: "Receive stock", exact: true }).click();
    await expectStoredReceipt(page, { reference, note, lines: [{ sku: first.sku, quantity: 12, costPence: 123 }] });
  });
}

test.describe("receiving without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("can add and remove lines, look up and correct codes, edit a review, and receive", async ({ page, baseURL }) => {
    const { blades: [first, second, third], makerRef, reference, db } = await deliveryFixture();
    await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
    await page.goto("/admin/stock/receive");
    const note = "Fictional manual stock receipt without scripts.";
    await page.getByLabel("Delivery reference").fill(reference);
    await page.getByLabel("Date received").fill(testReceivedOn);
    await page.getByLabel("Delivery note (optional)").fill(note);
    const firstCode = page.getByLabel("Blade code for line 1");
    const firstQty = page.getByLabel("Quantity for line 1");
    const firstCost = page.getByLabel("Unit cost (£) for line 1");
    const secondCode = page.getByLabel("Blade code for line 2");
    await firstCode.fill("TEST-NOT-FOUND");
    await firstQty.fill("3");
    await firstCost.fill("2.34");
    await page.getByRole("button", { name: "Add line", exact: true }).click();
    await secondCode.fill(third.sku);
    await page.getByLabel("Quantity for line 2").fill("99");
    await page.getByRole("button", { name: "Add line", exact: true }).click();
    await page.getByLabel("Blade code for line 3").fill(makerRef);
    await page.getByLabel("Quantity for line 3").fill("7");
    await page.getByRole("button", { name: "Remove line 2", exact: true }).click();
    await expect(secondCode).toHaveValue(makerRef);
    await expect(page.getByLabel("Quantity for line 2")).toHaveValue("7");
    await expect(page.getByLabel("Blade code for line 3")).toHaveCount(0);

    const check = page.getByRole("button", { name: "Check blade codes", exact: true });
    await check.click();
    await expect(page.getByText(/no match/i)).toBeVisible();
    await expect(page.getByText(second.name, { exact: true })).toBeVisible();
    await firstCode.fill(first.sku);
    await check.click();
    await expect(page.getByText(first.name, { exact: true })).toBeVisible();
    await expect(page.getByText(/no match/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Review delivery" }).click();
    const lines = page.getByRole("list", { name: "Reviewed delivery lines" });
    await expect(lines.getByRole("listitem")).toHaveCount(2);
    await expect(lines.getByText("£2.34", { exact: true })).toBeVisible();
    const stock = () => db.from("variants").select("stock_on_hand").in("id", [first.id, second.id, third.id]).order("sku");
    expect((await stock()).data?.map(({ stock_on_hand }) => stock_on_hand)).toEqual([0, 0, 0]);
    await page.getByRole("button", { name: "Back to edit", exact: true }).click();
    await expect(firstCode).toHaveValue(first.sku);
    await expect(firstQty).toHaveValue("3");
    await expect(firstCost).toHaveValue("2.34");
    await expect(secondCode).toHaveValue(makerRef);
    await expect(page.getByLabel("Delivery note (optional)")).toHaveValue(note);
    await firstQty.fill("4");
    await page.getByRole("button", { name: "Review delivery" }).click();
    await expect(lines.getByRole("listitem").filter({ hasText: first.sku }).getByText("4", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Receive stock", exact: true }).click();
    await expectStoredReceipt(page, { reference, note, lines: [
      { sku: first.sku, quantity: 4, costPence: 234 },
      { sku: second.sku, quantity: 7, costPence: null },
    ] });
    expect((await stock()).data?.map(({ stock_on_hand }) => stock_on_hand)).toEqual([4, 7, 0]);
  });

  test("can append pasted rows and a CSV to the same delivery, then review and receive", async ({ page, baseURL }) => {
    const { blades: [first, second], makerRef, reference } = await deliveryFixture();
    await setVerifiedStaffSession(page, await costedWarehouseUser(), baseURL);
    await page.goto("/admin/stock/receive");
    const note = "Fictional pasted and uploaded stock without scripts.";
    await page.getByLabel("Delivery reference").fill(reference);
    await page.getByLabel("Date received").fill(testReceivedOn);
    await page.getByLabel("Delivery note (optional)").fill(note);
    const spreadsheet = page.getByLabel("Spreadsheet rows");
    const upload = page.getByLabel("CSV file");
    await page.getByText("Import lines", { exact: true }).click();
    const renders = process.env.EDGEY_DELIVERY_RENDERS;
    if (renders) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(spreadsheet).toBeVisible();
      await expect(upload).toBeVisible();
      await page.screenshot({ path: join(renders, "no-js-import-390.png"), fullPage: true, animations: "disabled" });
    }
    await spreadsheet.fill(`code\tquantity\tunit cost\n${first.sku}\t5\t1.01`);
    await page.getByRole("button", { name: "Add imported lines" }).click();
    await expect(page.getByLabel("Blade code for line 1")).toHaveValue(first.sku);
    await expect(spreadsheet).toHaveValue("");
    if (!(await upload.isVisible())) await page.getByText("Import lines", { exact: true }).click();
    await upload.setInputFiles({
      name: "native-receipt.csv", mimeType: "text/csv", buffer: Buffer.from(`code,quantity\r\n"${makerRef}",8\r\n`),
    });
    await page.getByRole("button", { name: "Add imported lines" }).click();
    await expect(page.getByLabel("Blade code for line 1")).toHaveValue(first.sku);
    await expect(page.getByLabel("Blade code for line 2")).toHaveValue(makerRef);
    await expect(page.getByText(second.name, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review delivery" }).click();
    const lines = page.getByRole("list", { name: "Reviewed delivery lines" });
    await expect(lines.getByRole("listitem")).toHaveCount(2);
    await expect(lines.getByText(second.sku, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Receive stock", exact: true }).click();
    await expectStoredReceipt(page, { reference, note, lines: [
      { sku: first.sku, quantity: 5, costPence: 101 },
      { sku: second.sku, quantity: 8, costPence: null },
    ] });
  });
});

test("warehouse can fix a failed native pasted import without losing the table", async ({ browser, baseURL }) => {
  const { blades: [first], reference } = await deliveryFixture();
  const page = await browser.newPage({ baseURL, javaScriptEnabled: false });
  const note = "Fictional warehouse-only delivery.";
  try {
    await setVerifiedStaffSession(page, await createLocalAdminUser("warehouse"), baseURL);
    await page.goto("/admin/stock/receive");
    await page.getByLabel("Delivery reference").fill(reference);
    await page.getByLabel("Date received").fill(testReceivedOn);
    await page.getByLabel("Delivery note (optional)").fill(note);
    const invalid = `code,quantity\n"${first.sku},7`;
    await pasteLines(page, invalid);
    const paste = page.getByLabel("Spreadsheet rows");
    await expect(page.getByText(/check the quotes/i)).toBeVisible();
    await expect(paste).toBeVisible();
    await expect(paste).toHaveValue(invalid);

    await page.getByRole("button", { name: "Check blade codes" }).click();
    await expect(paste).toBeVisible();
    await expect(paste).toHaveValue(invalid);
    await page.getByRole("button", { name: "Review delivery" }).click();
    await expect(page.getByText(/add the pasted lines or clear/i)).toBeVisible();
    await expect(paste).toHaveValue(invalid);

    await paste.fill(`code,quantity,unit cost\n"${first.sku}",7,9.88`);
    await page.getByRole("button", { name: "Add imported lines" }).click();
    await expect(page.getByLabel("Blade code for line 1")).toHaveValue(first.sku);
    await expect(page.getByLabel(/unit cost .* for line 1/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Review delivery" }).click();
    await expect(page.getByRole("region", { name: "Review delivery" })).not.toContainText("9.88");
    await page.getByRole("button", { name: "Receive stock", exact: true }).click();
    await expectStoredReceipt(page, { reference, note, lines: [{ sku: first.sku, quantity: 7, costPence: null }] });
  } finally {
    await page.close();
  }
});

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
    await expect(page.locator(".admin-location")).toHaveText("Purchases");
    const menu = await openStaffMenu(page);
    await expect(menu.locator("[aria-current]")).toHaveCount(1);
    await expect(menu.getByRole("link", { name: "Delivery history" })).toHaveAttribute("aria-current", "location");
    await page.keyboard.press("Escape");
    await checkEverySize("record");
    await page.getByRole("link", { name: "Delivery history", exact: true }).click();
    await expect(page.getByRole("link", { name: reference })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    await scanAccessibility(page, theme);
  });
}
