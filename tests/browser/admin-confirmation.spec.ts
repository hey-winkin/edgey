import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb } from "../helpers/account-fixture";
import { switchTheme } from "../helpers/navigation";
import { setVerifiedStaffSession } from "./admin-fixtures";
import { withNet30Data } from "./fixtures/net30-data";

test("staff can review and close an enquiry with JavaScript off", async ({ browser, baseURL }, info) => {
  const db = await connectAccountDb();
  const staff = await createLocalAdminUser("catalogue");
  const id = randomUUID();
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 860 } });
  try {
    const result = await localAdminClient().rpc("submit_enquiry", {
      p_id: id, p_kind: "compatibility", p_email: "confirmation@example.test",
      p_query: "3910301", p_machine_brand: "zund", p_message: "Can you confirm the holder?",
    });
    if (result.error) throw result.error;
    const status = async () => (await db.query("select status from public.enquiries where id=$1", [id])).rows[0]?.status;
    const page = await context.newPage();
    await setVerifiedStaffSession(page, staff, baseURL);
    await page.goto(`/admin/requests/enquiries/${id}`);
    const disclosure = page.locator("summary").filter({ hasText: /^Close enquiry$/ });
    const submit = page.getByRole("button", { name: "Confirm close enquiry", exact: true });
    const checkbox = page.getByRole("checkbox", { name: "I confirm no further action is needed on this enquiry." });

    await expect(submit).toBeHidden();
    await disclosure.focus();
    await disclosure.press("Enter");
    await expect(submit).toBeVisible();
    await expect(checkbox).toHaveAccessibleDescription(
      "Staff can no longer reply or record a match once this enquiry is closed. Closing does not send an email.",
    );
    expect(await status()).toBe("pending");
    await disclosure.press("Enter");
    await expect(submit).toBeHidden();
    expect(await status()).toBe("pending");
    await disclosure.press("Enter");
    await disclosure.locator("..").screenshot({ path: info.outputPath("close-enquiry-dark-390.png") });

    await submit.click();
    await expect(checkbox).toBeFocused();
    expect(await status()).toBe("pending");

    await submit.evaluate((button: HTMLButtonElement) => { button.formNoValidate = true; });
    await submit.click();
    await expect(disclosure.locator("..").getByRole("alert")).toContainText("Confirm that you want to close this enquiry.");
    await expect(submit).toBeVisible();
    expect(await status()).toBe("pending");

    await checkbox.check();
    await submit.click();
    await expect(page.getByText("Closed", { exact: true })).toBeVisible();
    await expect(disclosure).toHaveCount(0);
    expect(await status()).toBe("resolved");
  } finally {
    await context.close();
    try {
      await db.query("delete from public.enquiries where id=$1", [id]);
      await db.query("delete from auth.users where id=$1", [staff.id]);
    } finally {
      await db.end();
    }
  }
});

test("finance keeps the whole credit limit on one line in a scrollable narrow table", async ({ page, baseURL }, info) => {
  await withNet30Data(async ({ db, application, finance }) => {
    await db.query("select public.review_trade_application($1,$2,'approved')", [application, finance.id]);
    const { rows: [account] } = await db.query<{ id: string }>("select id from public.approve_trade_account($1,$2,200000,$3)", [
      application, finance.id, `cus_${randomUUID().replaceAll("-", "")}`,
    ]);
    if (!account) throw new Error("No fixture trade account was created.");
    await setVerifiedStaffSession(page, finance, baseURL);
    await page.goto("/admin/finance");
    const region = page.getByRole("region", { name: "Trade accounts" });
    const row = region.getByRole("row").filter({ has: page.locator(`a[href="/admin/finance/accounts/${account.id}"]`) });
    const credit = row.getByRole("cell", { name: "£2,000.00", exact: true });
    await expect(credit).toBeVisible();
    for (const theme of ["dark", "light"] as const) {
      await switchTheme(page, theme);
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 860 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        expect(await credit.evaluate((element) => {
          const text = document.createRange();
          text.selectNodeContents(element);
          return text.getClientRects().length;
        })).toBe(1);
        await region.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await region.screenshot({ path: info.outputPath(`credit-limit-${theme}-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 390, height: 860 });
    await row.getByRole("link").click();
    const suspend = page.locator("summary").filter({ hasText: /^Suspend Net 30$/ });
    await suspend.click();
    await expect(suspend.locator("..")).toContainText("Existing orders and balances aren’t changed.");
    await suspend.locator("..").screenshot({ path: info.outputPath("suspend-net30-light-390.png") });
  });
});
