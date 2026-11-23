import { openStaffMenu, signOutFromStaffMenu, switchTheme } from "../helpers/navigation";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test as base, type Page } from "@playwright/test";
import { signInStaff } from "../browser/admin-fixtures";
import {
  buyerName, carrier, company, creditLimit, gross, partial, poReference, signInBuyer, tracking, withNet30Data, type Net30Data,
} from "../browser/fixtures/net30-data";
import { startStripeFixture } from "../browser/fixtures/net30-stripe";
import { confirmation, drainEmails } from "./storefront-fixtures";
import { scanBothThemes } from "../helpers/accessibility";

const test = base.extend<{
  net30Data: Net30Data;
  net30App: { origin: string; stripe: Awaited<ReturnType<typeof startStripeFixture>> };
}>({
  net30Data: async ({}, provide) => withNet30Data(provide),
  net30App: async ({ net30Data }, provide) => {
    const stripe = await startStripeFixture();
    const child = fork(join(process.cwd(), "tests/browser/fixtures/net30-next.mjs"), [], {
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: net30Data.supabaseUrl,
        NET30_CHECKOUT_ENABLED: "true",
        EDGEY_TEST_STRIPE_PORT: String(stripe.port),
        EDGEY_REQUEST_HASH_KEY: randomBytes(32).toString("hex"),
        STRIPE_SECRET_KEY: stripe.key,
        STRIPE_WEBHOOK_SECRET: stripe.secret,
      },
    });
    const exited = once(child, "exit");
    try {
      const [origin] = await Promise.race([
        once(child, "message", { signal: AbortSignal.timeout(30_000) }),
        exited.then(([code]) => { throw new Error(`Net 30 test app exited before startup (${code}).`); }),
      ]);
      if (typeof origin !== "string" || URL.parse(origin)?.hostname !== "127.0.0.1") {
        throw new Error("Net 30 test app did not start on loopback.");
      }
      await provide({ origin, stripe });
      expect(stripe.unexpected).toEqual([]);
    } finally {
      child.kill();
      try {
        await exited;
      } finally {
        await stripe.close();
      }
    }
  },
});
test.use({ trace: "off" });

const pounds = (pence: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

async function capture(page: Page, name: string) {
  const directory = process.env.EDGEY_NET30_RENDERS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  for (const theme of ["dark", "light"] as const) {
    await switchTheme(page, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({ path: join(directory, `net30-${name}-${theme}.png`), fullPage: true, animations: "disabled" });
  }
  await switchTheme(page, "dark");
}

test("approves trade terms, dispatches before payment, and shows partial and full settlement in buyer history",
  async ({ browser, net30Data, net30App }) => {
    test.setTimeout(90_000);
    const { db, buyer, finance, warehouse, application, slug, sku, variantId, eventIds } = net30Data;
    const { origin, stripe } = net30App;
    const buyerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    const financeContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    const warehouseContext = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    try {
      const buyerPage = await buyerContext.newPage();
      const financePage = await financeContext.newPage();
      const warehousePage = await warehouseContext.newPage();
      const method = buyerPage.getByRole("radio", { name: "Pay on account (Net 30)" });
      const orders = buyerPage.getByRole("region", { name: "Orders", exact: true });
      const trade = buyerPage.getByRole("region", { name: "Trade account", exact: true });
      const invoices = trade.getByRole("region", { name: "Invoices and PO references" });
      const delivery = buyerPage.getByRole("region", { name: "Delivery", exact: true });
      let orderId = "";
      let orderReference = "";
      let financeAccountPath = "";
      let dispatchedAt: string | null = null;

      async function assertPosition(remaining: number, status: string, paid: number) {
        const { rows } = await db.query(`
          select o.payment_status, o.fulfilment_status, o.paid_pence, o.dispatched_at::text,
            o.carrier, o.tracking_number, i.amount_remaining_pence, cp.held_pence::int,
            cp.outstanding_pence::int, cp.available_credit_pence::int
          from public.orders o join public.invoices i on i.order_id = o.id
          join public.trade_credit_position cp on cp.trade_account_id = o.trade_account_id
          where o.id = $1
        `, [orderId]);
        expect(rows).toEqual([{
          payment_status: status, fulfilment_status: dispatchedAt ? "dispatched" : "ready_to_pick",
          paid_pence: paid, dispatched_at: dispatchedAt, carrier: dispatchedAt && carrier,
          tracking_number: dispatchedAt && tracking, amount_remaining_pence: remaining, held_pence: 0,
          outstanding_pence: remaining, available_credit_pence: creditLimit - remaining,
        }]);
      }

      async function sendWebhook(type: string, eventId = `evt_${randomUUID().replaceAll("-", "")}`, tamper = false) {
        eventIds.push(eventId);
        const { body, signature } = stripe.webhook(type, eventId);
        const response = await buyerContext.request.post("/api/webhooks/stripe", {
          data: tamper ? Buffer.concat([body, Buffer.from(" ")]) : body,
          headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
        });
        expect(response.status()).toBe(tamper ? 400 : 200);
        const { rows } = await db.query("select state, last_error from public.provider_events where provider = 'stripe' and event_id = $1",
          [eventId]);
        expect(rows).toEqual(tamper ? [] : [{ state: "processed", last_error: null }]);
        return eventId;
      }

      await test.step("An unapproved buyer cannot select Net 30; Finance approves the application", async () => {
        await signInBuyer(buyerContext, origin, buyer);
        await buyerPage.goto("/account");
        await expect(trade.getByRole("heading", { name: "Application pending" })).toBeVisible();
        await buyerPage.goto(`/blades/${slug}`);
        await buyerPage.getByRole("button", { name: "Add to basket" }).click();
        await buyerPage.getByRole("dialog", { name: "Your basket" })
          .getByRole("link", { name: "Go to checkout" }).click();
        await expect(method).toBeDisabled();
        await expect(method).toHaveAccessibleDescription("Your trade account isn’t approved for Net 30.");

        await signInStaff(financePage, finance);
        await (await openStaffMenu(financePage)).getByRole("link", { name: "Customer requests", exact: true }).click();
        await financePage.getByRole("table", { name: "Trade applications" }).getByRole("row")
          .filter({ hasText: buyer.email }).getByRole("link", { name: company }).click();
        await expect(financePage).toHaveURL(`/admin/requests/trade/${application}`);
        await financePage.getByLabel("Initial credit limit (£)").fill((creditLimit / 100).toFixed(2));
        await financePage.getByRole("button", { name: "Approve trade account" }).click();
        const accountLink = financePage.getByRole("link", { name: "View trade account" });
        await expect(accountLink).toBeVisible();
        financeAccountPath = (await accountLink.getAttribute("href"))!;
        await capture(financePage, "01-approval");
        const createCustomer = stripe.calls.filter(({ method, path }) => method === "POST" && path === "/v1/customers");
        expect(createCustomer).toHaveLength(1);
        expect(createCustomer[0]?.params.get("metadata[edgey_trade_application_id]")).toBe(application);
        expect(createCustomer[0]?.params.get("address[line1]")).toBe("12 Foundry Lane");
        const email = await financeContext.request.get("/api/cron/request-emails", {
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
        });
        expect(email.status()).toBe(200);
        expect((await db.query("select state from public.order_outbox where trade_application_id=$1 and message_key='trade_approved'",
          [application])).rows).toEqual([{ state: "sent" }]);
      });

      await test.step("Required PO, gross credit and VAT reach the Stripe invoice before stock can be picked", async () => {
        await buyerPage.goto("/trade");
        await expect(buyerPage.getByText(/Select Pay on account \(Net 30\) at checkout/)).toBeVisible();
        await buyerPage.goto("/privacy");
        await buyerPage.getByRole("button", { name: "Turn on Finder analytics" }).click();
        await expect(buyerPage.getByRole("button", { name: "Turn off Finder analytics" })).toBeVisible();
        await buyerPage.goto(`/blades?q=${encodeURIComponent(sku)}`);
        await expect(buyerPage.locator(".p-card").filter({ hasText: "Exact match" })).toContainText(sku);
        await expect.poll(async () => (await buyerContext.cookies()).some(({ name }) => name === "edgey-finder-match")).toBe(true);
        await buyerPage.goto("/checkout");
        await buyerPage.getByLabel("Business name").fill(company);
        await buyerPage.getByLabel("Contact email").fill(buyer.email);
        await buyerPage.getByLabel("I’m buying for work").check();
        await buyerPage.getByLabel("Recipient name").fill(buyerName);
        await buyerPage.getByLabel("Address line 1").fill("18 Delivery Lane");
        await buyerPage.getByLabel("Town or city").fill("London");
        await buyerPage.getByLabel("Postcode").fill("SW1A 1AA");
        const summary = buyerPage.getByRole("region", { name: "Order summary" });
        await expect(summary).toContainText("Next working day");
        await expect(summary).toContainText(pounds(gross));
        await method.check();
        await expect(summary).toContainText("Dates are provisional until your invoice is issued.");
        const po = buyerPage.getByLabel("Purchase order reference (required)");
        const placeOrder = buyerPage.getByRole("button", { name: "Place order on account" });
        await placeOrder.click();
        await expect(po).toHaveAccessibleDescription("Enter a purchase order reference on one line.");
        await scanBothThemes(buyerPage);
        expect(stripe.calls.filter(({ path }) => path.startsWith("/v1/invoices"))).toEqual([]);
        await po.fill(poReference);
        await scanBothThemes(buyerPage);
        await capture(buyerPage, "02-checkout");
        const submitted = buyerPage.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/checkout/net30" && response.request().method() === "POST");
        await placeOrder.click();
        const response = await submitted;
        expect(await response.json()).toEqual({ status: "authorised", orderId: expect.any(String) });
        expect(response.status()).toBe(200);
        await expect(buyerPage).toHaveURL(/\/checkout\/net30\/[a-f0-9-]+$/);
        orderId = new URL(buyerPage.url()).pathname.split("/").at(-1)!;
        expect((await db.query(`select e.normalised_query from private.finder_order_attributions a
          join public.finder_search_events e on e.id = a.event_id where a.order_id = $1`, [orderId])).rows)
          .toEqual([{ normalised_query: sku.replace(/[^a-z0-9]/gi, "").toUpperCase() }]);
        orderReference = (await db.query<{ order_reference: string }>(
          "select order_reference from public.orders where id=$1", [orderId],
        )).rows[0]!.order_reference;
        expect(orderReference).toMatch(/^EDG-[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{5}$/);
        await expect(buyerPage.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
        await expect(buyerPage.getByText(orderReference, { exact: true })).toBeVisible();
        await expect(buyerPage.getByText(poReference, { exact: true })).toBeVisible();
        await expect(buyerPage.getByText("Total invoiced inc VAT")).toBeVisible();
        await expect(buyerPage.getByRole("link", { name: "View invoice", exact: true })).toHaveAttribute("href", stripe.invoiceUrl);
        await expect.poll(() => buyerPage.evaluate(() =>
          JSON.parse(localStorage.getItem("edgey-storefront-selection-v1") ?? "{}"))).toEqual({});
        await capture(buyerPage, "03-confirmation");
        const writes = stripe.calls.filter(({ method, path }) => method === "POST" && path.startsWith("/v1/invoices"));
        expect(writes.map(({ path }) => path)).toEqual([
          "/v1/invoices", ...["add_lines", "finalize", "send"].map((action) => `/v1/invoices/${stripe.invoiceId}/${action}`),
        ]);
        expect(writes[0]?.params.get("metadata[edgey_order_id]")).toBe(orderId);
        expect(writes[0]?.params.get("metadata[po_number]")).toBe(poReference);
        expect(writes[0]?.params.get("description")).toBe(`Edgey order ${orderReference}\nPurchase order: ${poReference}`);
        expect(writes[1]?.params.get("lines[0][tax_amounts][0][amount]")).toBe("470");
        expect(writes[1]?.params.get("lines[1][tax_amounts][0][amount]")).toBe("139");
        expect(new Set(writes.map(({ key }) => key)).size).toBe(4);
        expect(writes.every(({ key }) => Boolean(key))).toBe(true);
        await assertPosition(gross, "invoiced", 0);
      });

      await test.step("Warehouse records real dispatch and tracking while the invoice stays unpaid", async () => {
        await signInStaff(warehousePage, warehouse);
        await (await openStaffMenu(warehousePage)).getByRole("link", { name: "Pick and dispatch" }).click();
        await warehousePage.getByRole("link", { name: orderReference, exact: true }).click();
        await expect(warehousePage.getByText("Invoiced", { exact: true })).toBeVisible();
        await warehousePage.getByRole("button", { name: "Start picking" }).click();
        await warehousePage.getByLabel("Carrier").fill(carrier);
        await warehousePage.getByLabel("Tracking number").fill(tracking);
        await warehousePage.getByRole("button", { name: "Record dispatch" }).click();
        await expect(warehousePage.getByText(tracking, { exact: true })).toBeVisible();
        const { rows } = await db.query<{ dispatched_at: string }>("select dispatched_at::text from public.orders where id = $1", [orderId]);
        dispatchedAt = rows[0]?.dispatched_at ?? null;
        expect(dispatchedAt).not.toBeNull();
        await assertPosition(gross, "invoiced", 0);
        await capture(warehousePage, "04-dispatch-unpaid");
      });

      await test.step("A signed partial payment reduces exposure without changing fulfilment", async () => {
        stripe.pay(partial);
        await sendWebhook("invoice.payment_succeeded", undefined, true);
        await assertPosition(gross, "invoiced", 0);
        const eventId = await sendWebhook("invoice.payment_succeeded");
        await sendWebhook("invoice.payment_succeeded", eventId);
        await assertPosition(gross - partial, "partially_paid", partial);
        await financePage.goto(financeAccountPath);
        const financeInvoice = financePage.getByRole("table", { name: "Net 30 invoices" }).getByRole("row").filter({ hasText: poReference });
        await expect(financeInvoice.getByRole("cell", { name: "Partially paid", exact: true })).toBeVisible();
        await expect(financeInvoice.getByRole("cell", { name: pounds(gross - partial), exact: true })).toBeVisible();
        await capture(financePage, "05-partial-payment");
        await buyerPage.goto("/account");
        await expect(orders.getByRole("listitem")).toContainText("Partially paid");
        await expect(orders.getByRole("listitem")).toContainText("Dispatched");
        await expect(invoices.getByRole("listitem")).toContainText(pounds(gross - partial));
        await expect(trade.getByText(pounds(creditLimit - gross + partial), { exact: true })).toBeVisible();
        await capture(buyerPage, "06-partial-buyer-history");
      });

      await test.step("Final settlement restores credit and leaves the dispatched order and invoice linked", async () => {
        stripe.pay(gross - partial);
        await sendWebhook("invoice.paid");
        await assertPosition(0, "paid", gross);
        const { rows } = await db.query(`
          select kind, on_hand_delta, reserved_delta from public.stock_movements
          where order_id = $1 and variant_id = $2 order by id
        `, [orderId, variantId]);
        expect(rows).toEqual([
          { kind: "reserve", on_hand_delta: 0, reserved_delta: 1 },
          { kind: "dispatch", on_hand_delta: -1, reserved_delta: -1 },
        ]);
        await buyerPage.reload();
        await expect(trade.getByText(pounds(creditLimit), { exact: true })).toBeVisible();
        await expect(orders.getByRole("listitem").getByText("Paid", { exact: true })).toBeVisible();
        await expect(orders.getByRole("listitem").getByText("Dispatched", { exact: true })).toBeVisible();
        await expect(invoices.getByRole("listitem")).toContainText(`PO ${poReference}`);
        await expect(invoices.getByRole("listitem")).toContainText("Paid · Due");
        await expect(invoices.getByRole("listitem")).toContainText(pounds(0));
        await expect(invoices.getByRole("link", { name: `View invoice for PO ${poReference}` })).toHaveAttribute("href", stripe.invoiceUrl);
        await capture(buyerPage, "07-settled-buyer-history");
        await orders.getByRole("link", { name: `View order ${orderReference}` }).click();
        await expect(buyerPage).toHaveURL(`/account/orders/${orderId}`);
        await expect(buyerPage.getByRole("region", { name: "Order items" })).toContainText(sku);
        await expect(delivery.getByText(carrier, { exact: true })).toBeVisible();
        await expect(delivery.getByText(tracking, { exact: true })).toBeVisible();
        await expect(delivery.getByRole("link", { name: "View invoice" })).toHaveAttribute("href", stripe.invoiceUrl);
        await capture(buyerPage, "08-settled-tracking");
        await buyerPage.setViewportSize({ width: 390, height: 844 });
        await expect.poll(() => buyerPage.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
        await capture(buyerPage, "09-settled-tracking-mobile");
      });
    } finally {
      await Promise.all([buyerContext.close(), financeContext.close(), warehouseContext.close()]);
    }
  });

test("an agreed Net 30 service survives invoice-send recovery and later payment", async ({ browser, net30Data, net30App }) => {
  const { db, buyer, finance, warehouse, application, slug, eventIds } = net30Data;
  const { origin, stripe } = net30App;
  const service = "Tracked Net 30 fixture";
  const deliveryPence = 1495;
  const totalPence = 4614;
  const buyerContext = await browser.newContext({ baseURL: origin });
  const staffContext = await browser.newContext({ baseURL: origin });
  const calendars = (await db.query("select * from public.delivery_calendars")).rows;
  try {
    await db.query(`insert into public.delivery_rules (scope, code, kind, service_name, charge_ex_vat_pence, working_days)
      values ('district', 'SW4', 'agreed', $1, $2, 3)`, [service, deliveryPence]);
    const { rows: [calendar] } = await db.query(`select (now() at time zone 'Europe/London')::date::text as today,
      ((now() at time zone 'Europe/London')::date + 2)::text as closure`);
    const closure: string = calendar.closure;
    await db.query(`update public.delivery_calendars set active_from=$1::date, active_through=$1::date + 14,
      working_weekdays='{0,1,2,3,4,5,6}', bank_holidays='{}',
      closures=case when calendar='carrier' then array[$2::date] else '{}'::date[] end,
      cutoff_minutes=case when calendar='warehouse' then 0 else null end`, [calendar.today, closure]);
    const staffPage = await staffContext.newPage();
    await signInStaff(staffPage, finance);
    await staffPage.goto(`/admin/requests/trade/${application}`);
    await staffPage.getByLabel("Initial credit limit (£)").fill("200");
    await staffPage.getByRole("button", { name: "Approve trade account" }).click();
    await expect(staffPage.getByRole("link", { name: "View trade account" })).toBeVisible();
    await signOutFromStaffMenu(staffPage);
    await expect(staffPage).toHaveURL("/admin/sign-in");
    await signInStaff(staffPage, warehouse);

    await signInBuyer(buyerContext, origin, buyer);
    const buyerPage = await buyerContext.newPage();
    await buyerPage.goto(`/blades/${slug}`);
    await buyerPage.getByRole("button", { name: "Add to basket" }).click();
    await buyerPage.getByRole("dialog", { name: "Your basket" }).getByRole("link", { name: "Go to checkout" }).click();
    await buyerPage.getByLabel("Business name").fill(company);
    await buyerPage.getByLabel("Contact email").fill(buyer.email);
    await buyerPage.getByLabel("I’m buying for work").check();
    await buyerPage.getByLabel("Recipient name").fill(buyerName);
    await buyerPage.getByLabel("Address line 1").fill("18 Delivery Lane");
    await buyerPage.getByLabel("Town or city").fill("London");
    await buyerPage.getByLabel("Postcode").fill("SW4 1AA");
    const summary = buyerPage.getByRole("region", { name: "Order summary" });
    await expect(summary).toContainText(service);
    await expect(summary).toContainText(pounds(totalPence));
    await buyerPage.getByRole("radio", { name: "Pay on account (Net 30)" }).check();
    await buyerPage.getByLabel("Purchase order reference (required)").fill(poReference);

    stripe.dropNextSendResponse();
    const submitted = buyerPage.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/checkout/net30" && response.request().method() === "POST");
    await buyerPage.getByRole("button", { name: "Place order on account" }).click();
    const response = await submitted;
    expect(response.status(), await response.text()).toBe(202);
    expect(await response.json()).toMatchObject({ status: "confirming" });
    const { rows: [reserved] } = await db.query(`select id, delivery_terms, fulfilment_status, authorised_at,
      stripe_net30_sent, stripe_net30_invoice_id from public.orders where buyer_id=$1`, [buyer.id]);
    expect(reserved).toMatchObject({
      fulfilment_status: "awaiting_authorisation", authorised_at: null, stripe_net30_sent: false, stripe_net30_invoice_id: stripe.invoiceId,
      delivery_terms: { quote: { serviceName: service, workingDays: 3, chargeExVatPence: deliveryPence },
        deliveryCalendar: { closures: [closure] }, cutoffMinutes: 0 },
    });
    const lines = stripe.calls.find(({ path }) => path.endsWith("/add_lines"))?.params;
    expect(lines?.get("lines[1][amount]")).toBe(String(deliveryPence));
    expect(lines?.get("lines[1][tax_amounts][0][amount]")).toBe("299");
    expect(lines?.get("lines[1][description]")).toContain(service);

    await db.query(`delete from public.delivery_rules where scope='district' and code='SW4';
      update public.delivery_calendars set closures='{}', cutoff_minutes=case when calendar='warehouse' then 930 else null end`);
    const sendWebhook = async (type: string) => {
      const id = `evt_${randomUUID().replaceAll("-", "")}`;
      eventIds.push(id);
      const { body, signature } = stripe.webhook(type, id);
      const response = await buyerContext.request.post("/api/webhooks/stripe", {
        data: body, headers: { "Content-Type": "application/json", "Stripe-Signature": signature },
      });
      expect(response.status(), await response.text()).toBe(200);
    };
    await sendWebhook("invoice.sent");
    const { rows: [confirmed] } = await db.query(`select fulfilment_status, payment_status, delivery_terms, delivery_service,
      promised_dispatch_date::text, estimated_delivery_date::text,
      ((authorised_at at time zone 'Europe/London')::date + 1)::text as expected_dispatch,
      ((authorised_at at time zone 'Europe/London')::date + 4 + case when $2::date between
        (authorised_at at time zone 'Europe/London')::date + 2 and (authorised_at at time zone 'Europe/London')::date + 4
        then 1 else 0 end)::text as expected_delivery
      from public.orders where id=$1`, [reserved.id, closure]);
    expect(confirmed).toMatchObject({
      fulfilment_status: "ready_to_pick", payment_status: "invoiced", delivery_terms: reserved.delivery_terms,
      delivery_service: service, promised_dispatch_date: confirmed.expected_dispatch, estimated_delivery_date: confirmed.expected_delivery,
    });
    await buyerPage.goto(`/checkout/net30/${reserved.id}`);
    await expect(buyerPage.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
    await staffPage.goto(`/admin/warehouse/${reserved.id}`);
    for (const page of [buyerPage, staffPage]) {
      await expect(page.getByText(service, { exact: true })).toBeVisible();
      await expect(page.locator(`time[datetime='${confirmed.expected_dispatch}']`)).toBeVisible();
      await expect(page.locator(`time[datetime='${confirmed.expected_delivery}']`)).toBeVisible();
    }
    await drainEmails(buyerContext.request);
    const words = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeZone: "Europe/London" });
    expect((await confirmation(buyer.email)).text).toContain([
      `Delivery service: ${service}`,
      `Promised dispatch: ${words.format(new Date(confirmed.expected_dispatch))}`,
      `Estimated delivery: ${words.format(new Date(confirmed.expected_delivery))}`,
    ].join("\n"));

    stripe.pay(totalPence);
    await sendWebhook("invoice.paid");
    expect((await db.query(`select payment_status, paid_pence, delivery_terms, promised_dispatch_date::text, estimated_delivery_date::text
      from public.orders where id=$1`, [reserved.id])).rows).toEqual([{
      payment_status: "paid", paid_pence: totalPence, delivery_terms: reserved.delivery_terms,
      promised_dispatch_date: confirmed.expected_dispatch, estimated_delivery_date: confirmed.expected_delivery,
    }]);
  } finally {
    await db.query("delete from public.delivery_rules where scope='district' and code='SW4'");
    for (const calendar of calendars) {
      await db.query(`update public.delivery_calendars set active_from=$2, active_through=$3,
        working_weekdays=$4, bank_holidays=$5, closures=$6, cutoff_minutes=$7 where calendar=$1`,
        [calendar.calendar, calendar.active_from, calendar.active_through, calendar.working_weekdays,
          calendar.bank_holidays, calendar.closures, calendar.cutoff_minutes]);
    }
    await Promise.all([buyerContext.close(), staffContext.close()]);
  }
});
