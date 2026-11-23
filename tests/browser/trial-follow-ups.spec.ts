import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { saveThemeBeforeLoad, scanAccessibility, themes } from "../helpers/accessibility";
import { expectControlBoundary } from "../helpers/contrast";
import { setVerifiedStaffSession } from "./admin-fixtures";
import { withNet30Data } from "./fixtures/net30-data";

const listPath = "/admin/requests/trial-follow-ups";
const trials = ["Test North Print Room", "Test South Print Room"].map((company, index) => ({
  company, email: `print-room-${index + 1}@example.test`, days: 10 - 3 * index,
}));
const viewports = [
  { width: 1440, height: 900 }, { width: 1280, height: 800 },
  { width: 390, height: 844 }, { width: 320, height: 800 },
];

test.use({ locale: "en-GB" });

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const theme of themes) {
  test(`trial follow-ups and automatic holidays work across staff screen sizes in ${theme}`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await saveThemeBeforeLoad(page, theme);
    await withNet30Data(async ({ db, warehouse, variantId, sku }) => {
      const ids = trials.map(() => randomUUID());
      const images = process.env.EDGEY_STAFF_RENDER_DIR;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await db.query("insert into public.staff_members (user_id,role) values ($1,'catalogue')", [warehouse.id]);
        for (const [index, { company, email, days }] of trials.entries()) {
          const id = ids[index]!;
          await db.query("select public.submit_trial_request($1,'zund','3910301',$2,$3,'SW1A 1AA')", [id, email, company]);
          await db.query(`
            select public.review_admin_trial(id,$2,'eligible','Fit confirmed',array[$3::uuid,$3::uuid],updated_at)
            from public.trial_requests where id = $1
          `, [id, warehouse.id, variantId]);
          await db.query("select public.approve_trial_fulfilment($1,$2,array[$3::uuid,$3::uuid],$4,'Test Carrier','Standard',true)",
            [id, warehouse.id, variantId, { recipient_name: "Test Buyer", line1: "1 Test Street", town: "London", postcode: "SW1A 1AA", country: "GB" }]);
          await db.query("select public.dispatch_trial_fulfilment($1,$2,'TEST-123')", [id, warehouse.id]);
          await db.query(`
            update public.trial_fulfilments set dispatched_at =
              ((now() at time zone 'Europe/London')::date - $2::int + time '11:00') at time zone 'Europe/London'
            where trial_request_id = $1
          `, [id, days]);
        }
        await setVerifiedStaffSession(page, warehouse, baseURL);
        for (const [index, viewport] of viewports.entries()) {
          await test.step(`${viewport.width} × ${viewport.height}`, async () => {
            await page.setViewportSize(viewport);
            const screenshot = async (name: string, fullPage = false) => {
              if (images) await page.screenshot({
                path: join(images, `${name}-${viewport.width}x${viewport.height}-${theme}.png`),
                fullPage, animations: "disabled",
              });
            };
            await page.goto("/admin");
            const reminder = page.getByRole("link", { name: "2 trial follow-ups due" });
            await expect(reminder).toBeVisible();
            await expectNoOverflow(page);
            await screenshot("desk");
            await reminder.click();
            await expect(page).toHaveTitle("Trial follow-ups | Edgey");
            await expect(page.locator(".admin-location")).toHaveText("Sales orders");
            const queue = page.getByRole("list", { name: "Trials due for follow-up" });
            await expect(queue.getByRole("heading")).toHaveText(trials.map(({ company }) => company));
            await expect(queue.getByRole("listitem").first()).toContainText(trials[0]!.email);
            await expect(queue.getByRole("listitem").first()).toContainText(`2 × ${sku}`);
            await expect(queue.getByRole("listitem").first()).toContainText(/Days waiting\s*10/);
            await expectNoOverflow(page);
            if (index === viewports.length - 1) await scanAccessibility(page, theme);
            await screenshot("queue", true);
            await queue.getByRole("link", { name: trials[0]!.company }).click();
            await expect(page.getByRole("heading", { name: "Sales follow-up" })).toBeVisible();
            const contact = page.getByLabel("Contact date");
            const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", dateStyle: "short" }).format(new Date());
            await expect(contact).toHaveValue(today);
            const nextDate = page.getByLabel("Next follow-up date");
            await expect(nextDate).toHaveCount(0);
            await page.getByRole("combobox", { name: "Outcome" }).selectOption("follow_up_again");
            await expect(nextDate).toBeVisible();
            await expect(nextDate).toHaveAttribute("required", "");
            await expectNoOverflow(page);
            if (index === viewports.length - 1) {
              await expectControlBoundary(page.locator("#sales-follow-up form :is(input[type=date], select, textarea)"));
              await scanAccessibility(page, theme);
              const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);
              await nextDate.fill(tomorrow);
              await page.getByLabel("Note (optional)").fill("Test buyer asked for another call.");
            }
            await page.getByRole("heading", { name: "Sales follow-up" }).evaluate((element) => element.scrollIntoView());
            await screenshot("record");
            if (index === viewports.length - 1) {
              await page.getByRole("button", { name: "Record follow-up" }).click();
              await expect(page.getByRole("status").filter({ hasText: "Follow-up recorded." })).toBeVisible();
              await expect(page.getByText("Test buyer asked for another call.")).toBeVisible();
              await expect(page.getByLabel("Next follow-up date")).toHaveCount(0);
              await page.goto(listPath);
              await expect(page.getByRole("link", { name: trials[0]!.company })).toHaveCount(0);
              await expect(page.getByRole("link", { name: trials[1]!.company })).toBeVisible();
              await page.goto("/admin");
              await expect(page.getByRole("link", { name: "1 trial follow-up due" })).toBeVisible();
            }

            await page.goto("/admin/delivery");
            const holidays = page.getByRole("heading", { name: "Bank holidays (England and Wales)" });
            await expect(holidays).toBeVisible();
            const panel = holidays.locator("..");
            await expect(panel.locator("time").first()).toBeVisible();
            await expect(panel.getByText(/New Year|Christmas|Easter/).filter({ visible: true }).first()).toBeVisible();
            await expect(panel.locator("input,textarea")).toHaveCount(0);
            await expect(page.getByLabel("Other closures (YYYY-MM-DD)")).toHaveCount(2);
            await expectNoOverflow(page);
            if (index === viewports.length - 1) await scanAccessibility(page, theme);
            await holidays.evaluate((element) => element.scrollIntoView());
            await screenshot("delivery");
          });
        }
        expect(errors).toEqual([]);
      } finally {
        await db.query("begin");
        try {
          for (const table of ["trial_follow_ups", "order_outbox", "stock_movements", "trial_allocations"]) {
            await db.query(`delete from public.${table} where trial_request_id = any($1::uuid[])`, [ids]);
          }
          await db.query("delete from public.trial_fulfilments where trial_request_id = any($1::uuid[])", [ids]);
          await db.query("delete from public.trial_requests where id = any($1::uuid[])", [ids]);
          await db.query("commit");
        } catch (error) {
          await db.query("rollback");
          throw error;
        }
      }
    });
  });
}
