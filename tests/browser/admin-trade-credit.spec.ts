import { switchTheme } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signInStaff } from "./admin-fixtures";
import { company, signInBuyer, withNet30Data } from "./fixtures/net30-data";

async function captureFinance(page: Page, name: string) {
  const directory = process.env.EDGEY_NET30_RENDERS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const original = page.viewportSize();
  for (const theme of ["dark", "light"] as const) {
    await switchTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await page.screenshot({ path: join(directory, `${name}-${theme}-${width}.png`), fullPage: true, animations: "disabled" });
    }
  }
  await switchTheme(page, "dark");
  if (original) await page.setViewportSize(original);
}

test("finance changes Net 30 terms without changing invoice exposure and can follow up overdue balances", async ({ page, browser, baseURL }) => {
  await withNet30Data(async ({ db, application, buyer, finance, warehouse, variantId }) => {
    await db.query("select public.review_trade_application($1,$2,'approved')", [application, finance.id]);
    const account = await db.query<{ id: string }>("select id from public.approve_trade_account($1,$2,20000,$3)", [
      application, finance.id, `cus_${randomUUID().replaceAll("-", "")}`,
    ]);
    const accountId = account.rows[0]!.id;
    const order = await db.query<{ id: string; order_reference: string }>(`
      select id, order_reference from public.create_net30_order_with_holds(
        $1,$2,$3,$4,$5,now() + interval '35 minutes','Next working day','2099-01-05','2099-01-06',$6,'PO-FOLLOW-UP')
    `, [
      randomUUID(), JSON.stringify([{ variant_id: variantId, quantity: 1, unit_price_pence: 2350 }]),
      JSON.stringify({ email: buyer.email, business_name: company, recipient_name: "Alex Morgan", buying_for_work: true }),
      JSON.stringify({ line1: "1 Fixture Lane", town: "London", country: "GB", postcode: "SW1A 1AA" }),
      JSON.stringify({ goods_net_pence: 2350, delivery_net_pence: 0, vat_rate_bps: 2000, vat_pence: 470, gross_pence: 2820 }),
      buyer.id,
    ]);
    const { id: orderId, order_reference: reference } = order.rows[0]!;
    const invoiceId = `in_${randomUUID().replaceAll("-", "")}`;
    await db.query(`
      select public.bind_invoice($1,$2,stripe_customer_id,2820,'GBP',now() - interval '40 days',
        now() - interval '10 days','2099-01-05','2099-01-06') from public.trade_accounts where id=$3
    `, [orderId, invoiceId, accountId]);
    await db.query("select public.set_buyer_invoice_url($1,$2,$3)",
      [orderId, invoiceId, `https://invoice.stripe.com/i/${invoiceId}`]);
    await db.query("select public.cancel_order($1,$2,$3)", [orderId, randomUUID(), warehouse.id]);
    const context = await browser.newContext({ baseURL });
    try {
      await signInBuyer(context, baseURL!, buyer);
      const buyerPage = await context.newPage();
      await buyerPage.goto(`/checkout/net30/${orderId}`);
      await expect(buyerPage.getByRole("heading", { name: "This account order was cancelled" })).toBeVisible();
      await expect(buyerPage.getByRole("link", { name: "View invoice" })).toHaveCount(0);
      await buyerPage.getByRole("link", { name: "View order in your account" }).click();
      await expect(buyerPage.getByRole("heading", { name: "Order details" })).toBeVisible();
      await expect(buyerPage.getByRole("link", { name: "View invoice" })).toHaveCount(0);
      await buyerPage.getByRole("link", { name: "Back to account" }).click();
      const invoiceRow = buyerPage.getByRole("listitem").filter({ hasText: "PO PO-FOLLOW-UP" });
      await expect(invoiceRow).toContainText("Cancelled, do not pay");
      await expect(invoiceRow.getByRole("link", { name: "View invoice for PO PO-FOLLOW-UP" })).toHaveCount(0);
    } finally {
      await context.close();
    }
    await db.query("update public.orders set payment_review_reason='invoice_issued_after_hold_released' where id=$1", [orderId]);
    await signInStaff(page, finance);
    await page.goto("/admin/finance");
    const overdue = page.getByRole("table", { name: "Overdue invoices" }).getByRole("row", { name: /PO-FOLLOW-UP/ });
    await expect(overdue).toContainText(buyer.email);
    await expect(overdue).toContainText("£28.20");
    const cancelled = page.getByRole("table", { name: "Cancelled Net 30 orders" }).getByRole("row", { name: /PO-FOLLOW-UP/ });
    const paymentReview = page.getByRole("table", { name: "Payment review" });
    await expect(paymentReview.getByRole("row", { name: new RegExp(reference) })).toBeVisible();
    await expect(cancelled.getByLabel("Confirm void")).not.toBeChecked();
    await expect(cancelled.getByRole("button", { name: "Verify and void invoice" })).toBeVisible();
    await expect(cancelled.getByRole("button", { name: "Verify Stripe adjustments" })).toBeVisible();
    await captureFinance(page, "finance-overview");
    await overdue.getByRole("link", { name: company }).click();
    await expect(page).toHaveURL(`/admin/finance/accounts/${accountId}`);
    const balances = page.getByRole("heading", { name: "Credit position" }).locator("..");
    await expect(balances).toContainText("£171.80");
    await captureFinance(page, "finance-account");
    const limit = page.getByLabel("Credit limit (£)");
    await limit.fill("20.00");
    await page.getByRole("button", { name: "Save credit limit" }).click();
    await expect(balances).toContainText("£20.00");
    await expect(balances).toContainText("£0.00");
    await page.getByLabel("Internal reason").fill("Invoice follow-up in progress");
    await page.getByRole("button", { name: "Suspend Net 30", exact: true }).click();
    await expect(balances).toContainText("Suspended");
    await page.getByLabel("Internal reason").fill("Manual review complete");
    await page.getByRole("button", { name: "Reinstate Net 30", exact: true }).click();
    await expect(balances).toContainText("Approved");
    await expect(page.getByRole("table", { name: "Net 30 invoices" }).getByRole("row", { name: /PO-FOLLOW-UP/ })).toContainText("£28.20");
    await db.query("select public.void_invoice(provider_invoice_id) from public.invoices where order_id=$1", [orderId]);
    await page.goto("/admin/finance");
    await expect(cancelled).toHaveCount(0);
    await expect(paymentReview.getByRole("row", { name: new RegExp(reference) })).toHaveCount(0);
  });
});

test("only finance can see and submit a trade decision, and the rejection reason remains internal", async ({ page, browser, baseURL }) => {
  await withNet30Data(async ({ db, application, finance, warehouse }) => {
    const path = `/admin/requests/trade/${application}`;
    const reason = "Fixture: finance review was not satisfactory";
    await signInStaff(page, finance);
    await page.goto(path);
    await captureFinance(page, "trade-application-pending");
    const warehouseContext = await browser.newContext({ baseURL });
    try {
      const otherPage = await warehouseContext.newPage();
      await signInStaff(otherPage, warehouse);
      await otherPage.goto(path);
      await expect(otherPage).toHaveURL(/\/admin$/);
      const financeCookies = await page.context().cookies();
      await page.getByLabel("Internal rejection reason").fill(reason);
      await page.context().clearCookies();
      await page.context().addCookies(await warehouseContext.cookies());
      await page.getByRole("button", { name: "Reject application", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
      const rejected = () => db.query("select status,rejection_reason from public.trade_applications where id=$1", [application]);
      expect((await rejected()).rows[0]).toEqual({ status: "pending", rejection_reason: null });
      await page.context().clearCookies();
      await page.context().addCookies(financeCookies);
      await page.goto(path);
      await page.getByLabel("Internal rejection reason").fill(reason);
      await page.getByRole("button", { name: "Reject application", exact: true }).click();
      await expect(page.getByText(reason, { exact: true })).toBeVisible();
      expect((await rejected()).rows[0]).toEqual({ status: "rejected", rejection_reason: reason });
      const notice = await db.query("select message_body from public.order_outbox where trade_application_id=$1 and message_key='trade_rejected'", [application]);
      expect(notice.rowCount).toBe(1);
      expect(notice.rows[0].message_body).not.toContain(reason);
    } finally {
      await warehouseContext.close();
    }
  });
});
