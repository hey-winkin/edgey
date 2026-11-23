import { signOutFromStaffMenu, switchTheme } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { seedPaidAdminOrder, signInStaff } from "./admin-fixtures";

async function inspectAtWidths(page: Page, name: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const directory = process.env.EDGEY_ADMIN_REQUEST_RENDERS;
  if (directory) await mkdir(directory, { recursive: true });
  for (const [theme, nextMode] of [["dark", "light"], ["light", "dark"]] as const) {
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 940 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const back = page.getByRole("link", { name: "Requests inbox" });
      await back.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(back).toBeFocused();
      await expect(back).toHaveCSS("outline-style", "solid");
      await page.getByRole("heading", { level: 1 }).click();
      if (directory) await page.screenshot({ path: join(directory, `${name}-${theme}-${width}.png`), fullPage: true });
    }
    await switchTheme(page, nextMode);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("catalogue and warehouse take a five-field trial through dispatch to a linked first purchase", async ({ page }) => {
  test.setTimeout(60_000);
  const db = localAdminClient();
  const [catalogue, warehouse, buyer] = await Promise.all([
    createLocalAdminUser("catalogue"), createLocalAdminUser("warehouse"), createLocalAdminUser("buyer"),
  ]);
  const company = `The Proof Room ${randomUUID().slice(0, 6)}`;
  const { error: earlierError } = await db.rpc("submit_trial_request", {
    p_id: randomUUID(), p_machine_brand: "Zünd", p_oem_code: "3910110",
    p_email: buyer.email, p_company: company, p_postcode: "SW1A 1AA",
  });
  if (earlierError) throw earlierError;

  await page.goto("/sample-pack");
  const submission = page.getByRole("main").locator("form");
  await expect(submission.getByRole("textbox")).toHaveCount(4);
  await expect(submission.getByRole("combobox")).toHaveCount(1);
  await submission.getByLabel("Machine brand").selectOption({ label: "Zünd" });
  await submission.getByLabel("OEM code").fill("3910110");
  await submission.getByLabel("Work email").fill(buyer.email);
  await submission.getByLabel("Company").fill(company);
  await submission.getByLabel("Postcode").fill("SW1A1AA");
  await submission.getByRole("button", { name: "Request trial blades" }).click();
  await expect(page.getByRole("heading", { name: "Trial request received" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("No delivery has been arranged");

  await signInStaff(page, catalogue);
  await page.getByRole("main").getByRole("link", { name: "Requests", exact: true }).last().click();
  await page.getByRole("table", { name: "Trial requests", exact: true }).getByRole("link", { name: company, exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Trial request" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Trial email status" }).getByRole("row", { name: /Customer receipt/ }))
    .toContainText("Queued");
  await expect(page.getByRole("table", { name: "Possible duplicate trial requests" })).toContainText("Email · Company · Postcode");
  await expect(page.getByText("Within configured coverage", { exact: false })).toBeVisible();
  const trialPath = new URL(page.url()).pathname;
  const trialId = trialPath.split("/").at(-1)!;
  const sku = "EDG-Z1";
  const readStock = () => db.from("variants").select("id,stock_reserved,stock_on_hand").eq("sku", sku).single();
  const { data: stock, error: stockError } = await readStock();
  if (stockError) throw stockError;
  await expect(page.getByLabel("Recipient name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Record dispatch" })).toHaveCount(0);
  await inspectAtWidths(page, "trial-review");
  const decline = page.locator("summary").filter({ hasText: /^Decline trial$/ });
  await decline.click();
  await page.getByLabel("Decline reason").fill("Fixture reason for an unconfirmed decision.");
  const declineSubmit = page.getByRole("button", { name: "Confirm decline trial", exact: true });
  await declineSubmit.evaluate((button: HTMLButtonElement) => { button.formNoValidate = true; });
  await declineSubmit.click();
  await expect(decline.locator("..").getByRole("alert")).toHaveText("Confirm that you want to decline this trial.");
  const unchangedTrial = await db.from("trial_requests").select("status,staff_notes").eq("id", trialId).single();
  if (unchangedTrial.error) throw unchangedTrial.error;
  expect(unchangedTrial.data).toEqual({ status: "pending", staff_notes: null });
  await decline.click();
  await page.getByLabel("First blade unit").selectOption(stock.id);
  await page.getByLabel("Eligibility reason").fill("Confirmed against the matching holder and first request.");
  await page.getByRole("button", { name: "Record eligible decision" }).click();
  expect(await page.getByLabel("Second blade unit").evaluate((select: HTMLSelectElement) => select.validity.valueMissing)).toBe(true);
  await page.getByLabel("Second blade unit").selectOption(stock.id);
  await page.getByRole("button", { name: "Record eligible decision" }).click();
  await expect(page.getByRole("table", { name: "Trial blade units" })).toContainText(sku);
  expect((await readStock()).data).toMatchObject({ stock_reserved: stock.stock_reserved });

  await signOutFromStaffMenu(page);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await signInStaff(page, warehouse);
  const count = page.getByText("Trials linked to a first purchase:", { exact: false });
  const initial = Number(await count.locator("span").textContent());
  expect(Number.isNaN(initial)).toBe(false);
  await page.goto(trialPath);
  await expect(page.getByRole("button", { name: "Record dispatch" })).toHaveCount(0);
  await inspectAtWidths(page, "trial-approval");
  await page.getByLabel("Recipient name").fill("Alex Fixture");
  await page.getByLabel("Address line 1").fill("9 Print Road");
  await page.getByLabel("Town or city").fill("London");
  await page.getByLabel("Delivery postcode").fill("HS1 2AA");
  await page.getByLabel("Carrier", { exact: true }).fill("Fixture Carrier");
  await page.getByLabel("Carrier service", { exact: true }).fill("Tracked service");
  await page.getByLabel("I verified that this carrier service").check();
  await page.getByRole("button", { name: "Approve and reserve two units" }).click();
  await expect(page.getByLabel("Delivery postcode")).toHaveAccessibleDescription(/outside configured coverage/);
  await expect(page.getByRole("button", { name: "Record dispatch" })).toHaveCount(0);
  await expect(page.getByLabel("Address line 1")).toHaveValue("9 Print Road");
  await page.getByLabel("Delivery postcode").fill("SW1A1AA");
  await page.getByLabel("I verified that this carrier service").check();
  await page.getByRole("button", { name: "Approve and reserve two units" }).click();
  await expect(page.getByText("Approved · two units reserved")).toBeVisible();
  await expect(page.getByText("9 Print Road, London, SW1A 1AA, United Kingdom")).toBeVisible();
  expect((await readStock()).data).toMatchObject({ stock_reserved: stock.stock_reserved + 2, stock_on_hand: stock.stock_on_hand });
  await inspectAtWidths(page, "trial-allocated");

  await page.getByLabel("Tracking number").fill("FIXTURE-TRACK-100");
  await page.getByRole("button", { name: "Record dispatch" }).click();
  await expect(page.getByRole("heading", { name: "Link a subsequent order" })).toBeVisible();
  await expect(page.getByText("FIXTURE-TRACK-100")).toBeVisible();
  expect((await readStock()).data).toMatchObject({ stock_reserved: stock.stock_reserved, stock_on_hand: stock.stock_on_hand - 2 });
  const { data: messages, error: messageError } = await db.from("order_outbox").select("message_key").eq("trial_request_id", trialId);
  if (messageError) throw messageError;
  expect(messages.map((row) => row.message_key).sort()).toEqual(["confirmation", "staff_notification", "trial_approved", "trial_dispatched"]);

  const order = await seedPaidAdminOrder({ sku, buyerId: buyer.id, email: "other-contact@example.test" });
  const { data: orderRow, error: orderError } = await db.from("orders").select("order_reference").eq("id", order.id).single();
  if (orderError) throw orderError;
  const reference = orderRow.order_reference;
  await page.reload();
  const candidate = page.getByRole("table", { name: "Possible subsequent orders" }).getByRole("row").filter({ hasText: reference });
  await expect(candidate).toContainText("Verified account email");
  await candidate.getByRole("link", { name: "Use this order" }).click();
  await expect(page.getByRole("textbox", { name: "Order reference" })).toHaveValue(reference);
  await page.getByLabel("I confirmed this order followed the trial").check();
  await page.getByRole("button", { name: "Link order" }).click();
  const linked = page.getByRole("link", { name: reference });
  await expect(linked).toHaveAttribute("href", `/admin/warehouse/${order.id}`);
  await inspectAtWidths(page, "trial-linked");
  await linked.click();
  await expect(page.getByRole("link", { name: "View trial request" })).toHaveAttribute("href", trialPath);
  await page.goto("/admin");
  await expect(count.locator("span")).toHaveText(String(initial + 1));
  await page.goto(trialPath);
  await page.locator("summary").filter({ hasText: "Remove order link" }).click();
  await page.getByLabel("I confirm this trial and order should no longer be linked.").check();
  await page.getByRole("button", { name: "Confirm remove order link" }).click();
  await expect(page.getByRole("heading", { name: "Link a subsequent order" })).toBeVisible();
  await page.goto(`/admin/warehouse/${order.id}`);
  await expect(page.getByRole("link", { name: "View trial request" })).toHaveCount(0);
  await page.goto("/admin");
  await expect(count.locator("span")).toHaveText(String(initial));

  await signOutFromStaffMenu(page);
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
  await signInStaff(page, catalogue);
  await page.goto(trialPath);
  await expect(page.getByRole("heading", { name: "Trial request" })).toBeVisible();
  await expect(page.getByText("9 Print Road", { exact: false })).toHaveCount(0);
});

test("staff reply, match a compatibility enquiry privately and close it", async ({ page }) => {
  test.setTimeout(45_000);
  const db = localAdminClient();
  const catalogue = await createLocalAdminUser("catalogue");
  const id = randomUUID();
  const code = `DEMO-${id.slice(0, 8)}`;
  const { error } = await db.rpc("submit_enquiry", {
    p_id: id, p_kind: "compatibility", p_email: "alex@example.test",
    p_query: code, p_machine_brand: "zund", p_message: "Can you check whether this fits my holder?",
  });
  if (error) throw error;
  await signInStaff(page, catalogue);
  await page.goto(`/admin/requests/enquiries/${id}`);
  await expect(page.getByRole("heading", { name: "Compatibility enquiry" })).toBeVisible();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByText("Zünd", { exact: true })).toBeVisible();
  await expect(page.getByText("Can you check whether this fits my holder?")).toBeVisible();
  await inspectAtWidths(page, "enquiry-open");
  await page.getByLabel("Reply", { exact: true }).fill("Thanks. We are checking the holder.");
  await page.getByRole("button", { name: "Queue reply" }).click();
  await expect(page.getByText("Thanks. We are checking the holder.")).toBeVisible();
  await expect(page.getByText("Replied", { exact: true })).toBeVisible();
  const { data: variant, error: variantError } = await db.from("variants").select("id").eq("sku", "EDG-Z1").single();
  if (variantError) throw variantError;
  await page.getByLabel("Matched variant").selectOption(variant.id);
  await page.getByLabel("Private candidate code", { exact: false }).fill(code);
  await page.getByRole("button", { name: "Record match" }).click();
  await expect(page.getByText("Matched", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^EDG-Z1/ })).toHaveAttribute("href", `/admin/catalogue/${variant.id}`);
  await page.locator("summary").filter({ hasText: /^Close enquiry$/ }).click();
  await page.getByLabel("I confirm no further action is needed on this enquiry.").check();
  await page.getByRole("button", { name: "Confirm close enquiry" }).click();
  await expect(page.getByText("Closed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue reply" })).toHaveCount(0);
});
