import { signOutFromStaffMenu } from "../helpers/navigation";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { signInStaff } from "../browser/admin-fixtures";
import {
  capture, chooseBlade, confirmation, database, dispatchAt, drainEmails, email, event, payByCard,
  paymentButton, review, summary, visitSuccess,
} from "./storefront-fixtures";

test("warehouse settings quote an agreed card service and capture uses the reserved terms", async ({ browser, page, request }, info) => {
  const db = await database();
  const buyer = await browser.newPage();
  const charge = 1_295;
  const service = "Tracked three-day fixture";
  try {
    await dispatchAt("2026-07-10T14:29:00Z");
    await db.query("truncate private.payment_rate_limits");
    const finance = await createLocalAdminUser("finance");
    await signInStaff(page, finance);
    await page.goto("/admin/delivery");
    await expect(page).toHaveURL("/admin");
    await expect(page.getByRole("link", { name: "Customer delivery settings" })).toHaveCount(0);
    await signOutFromStaffMenu(page);
    await expect(page).toHaveURL("/admin/sign-in");
    await signInStaff(page, await createLocalAdminUser("warehouse"));
    await page.getByRole("link", { name: "Customer delivery settings" }).click();
    await expect(page.getByRole("heading", { name: "Customer delivery settings" })).toBeVisible();
    await page.getByLabel("Rule scope").selectOption("district");
    await page.getByLabel("Postcode area or district").fill("sw2");
    await page.getByLabel("Service type").selectOption("agreed");
    await page.getByLabel("Service name").fill(service);
    await page.getByLabel("Agreed price ex VAT (£)").fill("12.95");
    await page.getByLabel("Agreed transit (working days)").fill("3");
    await page.getByRole("button", { name: "Save postcode rule" }).click();
    await expect(page.getByRole("row").filter({ hasText: "SW2" })).toContainText(service);
    await page.getByLabel("Rule scope").selectOption("district");
    await page.getByLabel("Postcode area or district").fill("SW3");
    await page.getByLabel("Service type").selectOption("enquiry");
    await page.getByRole("button", { name: "Save postcode rule" }).click();
    await expect(page.getByRole("row").filter({ hasText: "SW3" })).toContainText("Enquiry only");
    await page.getByRole("heading", { name: "Warehouse calendar" }).locator("..")
      .getByLabel("Other closures (YYYY-MM-DD)").fill("2026-07-13");
    await page.getByRole("button", { name: "Save warehouse calendar" }).click();
    await expect.poll(async () => (await db.query("select closures::text from public.delivery_calendars where calendar='warehouse'"))
      .rows[0]?.closures).toBe("{2026-07-13}");
    await page.getByRole("heading", { name: "Carrier calendar" }).locator("..")
      .getByLabel("Other closures (YYYY-MM-DD)").fill("2026-07-15");
    await page.getByRole("button", { name: "Save carrier calendar" }).click();
    await expect.poll(async () => (await db.query("select closures::text from public.delivery_calendars where calendar='carrier'"))
      .rows[0]?.closures).toBe("{2026-07-15}");
    await page.screenshot({ path: info.outputPath("delivery-settings.png") });

    await chooseBlade(buyer, "/blades/edg-z10");
    const recipient = await review(buyer, { email: email(), postcode: "SW3 1AA" });
    await expect(buyer.getByRole("link", { name: "Ask us about delivery" })).toBeVisible();
    await expect(paymentButton(buyer)).toBeDisabled();
    await buyer.getByLabel("Postcode").fill("SW2 1AA");
    const checkout = summary(buyer);
    await expect(checkout).toContainText(service);
    await expect(checkout).toContainText("£12.95");
    await expect(checkout).toContainText("Friday 10 July");
    await expect(checkout).toContainText("Thursday 16 July");
    const session = await payByCard(buyer);
    expect(session.amount_total).toBe(4254);
    expect(session.lines).toContainEqual(expect.objectContaining({ name: `Delivery · ${service}`, amount: 1554 }));
    const reserved = (await db.query("select delivery_terms from public.orders where id=$1", [session.client_reference_id]))
      .rows[0]?.delivery_terms;
    expect(reserved).toMatchObject({
      quote: { kind: "agreed", serviceName: service, workingDays: 3, chargeExVatPence: charge },
      warehouseCalendar: { closures: ["2026-07-13"] }, deliveryCalendar: { closures: ["2026-07-15"] },
    });

    await db.query(`update public.delivery_rules set kind='enquiry', service_name=null, charge_ex_vat_pence=null,
      working_days=null where scope='district' and code='SW2'; update public.delivery_calendars set closures='{}'`);
    await capture(session.id, "2026-07-10T14:30:00Z");
    const eventId = await event(request, "checkout.session.completed", session.id);
    await visitSuccess(buyer, session);
    await expect(buyer.getByText(service, { exact: true })).toBeVisible();
    await expect(buyer.locator("time[datetime='2026-07-14']")).toBeVisible();
    await expect(buyer.locator("time[datetime='2026-07-20']")).toBeVisible();
    await page.goto(`/admin/warehouse/${session.client_reference_id}`);
    await page.getByRole("link", { name: "Printable pick list" }).click();
    await expect(page.getByText(service, { exact: true })).toBeVisible();
    await expect(page.locator("time[datetime='2026-07-14']")).toBeVisible();
    await expect(page.locator("time[datetime='2026-07-20']")).toBeVisible();
    await event(request, "checkout.session.completed", session.id, eventId);
    await drainEmails(request);
    expect((await confirmation(recipient)).text).toContain(`Delivery service: ${service}\nPromised dispatch: Tuesday, 14 July 2026\nEstimated delivery: Monday, 20 July 2026`);
    expect((await db.query(`select delivery_terms, fulfilment_status, promised_dispatch_date::text, estimated_delivery_date::text
      from public.orders where id=$1`, [session.client_reference_id])).rows).toEqual([{
      delivery_terms: reserved, fulfilment_status: "ready_to_pick",
      promised_dispatch_date: "2026-07-14", estimated_delivery_date: "2026-07-20",
    }]);
  } finally {
    await db.query("delete from public.delivery_rules where scope = 'district' and code in ('SW2','SW3'); update public.delivery_calendars set closures='{}'");
    await db.end();
    await buyer.close();
  }
});
