import { signOutFromStaffMenu } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test as base, type Page } from "@playwright/test";
import type { Client } from "pg";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import type { Database } from "../../src/lib/supabase/database.types";
import { signInStaff } from "../browser/admin-fixtures";
import { createAccountCatalogue, createAccountOrder } from "../helpers/account-fixture";
import { scanBothThemes } from "../helpers/accessibility";
import {
  addBlade, capture, checkoutPayload, chooseBlade, confirmation, database, dispatchAt, drainEmails,
  dropNextCreateResponse, email, messagesTo,
  event, expire, payByCard, paymentButton, pickList, providerSessions, receiptReference, review, selection,
  sessionPath, stubHostedPayment, summary, visitSuccess,
} from "./storefront-fixtures";

const test = base.extend<{ db: Client }>({
  db: async ({}, provide) => {
    const db = await database();
    try {
      await provide(db);
    } finally {
      await db.end();
    }
  },
});
const z10 = "/blades/edg-z10";
const mimaki = "/blades/edg-mim-45";
const gbp = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

test.beforeEach(async ({ db }) => {
  await dispatchAt("2026-07-07T14:29:00Z");
  await db.query("truncate private.payment_rate_limits");
});

test("Exact, ambiguous and unknown searches", async ({ page }) => {
  for (const query of ["edg z10", "eDG-Z10", " 3910-301 "]) {
    await page.goto("/?q=" + encodeURIComponent(query));
    const results = page.locator(".cards").getByRole("link");
    await expect(results.first()).toHaveAccessibleName("EDG-Z10 Flat-stock drag blade");
    await expect(results.first()).toHaveAccessibleDescription(/Exact match.*£22.50 ex VAT/);
    await results.first().click();
    const dialog = page.getByRole("dialog", { name: "Flat-stock drag blade" });
    await expect(dialog).toContainText("3910301");
    await expect(dialog.getByRole("button", { name: "Add to basket" })).toBeEnabled();
  }
  await page.goto("/blades?q=spb%200030");
  const family = page.getByRole("link", { name: /EDG-MIM-45/ });
  await expect(page.locator(".p-card").filter({ has: family })).toContainText("45° · 1.5 mm diameter or 60° · 1.5 mm diameter");
  await family.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Choose the configuration");
  await expect(dialog.getByRole("button", { name: "Add to basket" })).toBeDisabled();
  const standard = dialog.getByRole("button", { name: "45° Standard vinyl drag blade", exact: true });
  const thick = dialog.getByRole("button", { name: "60° Thick / reflective / flock drag blade", exact: true });
  await expect(standard).toHaveAttribute("aria-pressed", "false");
  await expect(thick).toHaveAttribute("aria-pressed", "false");
  await thick.click();
  await expect(page).toHaveURL(/variant=EDG-MIM-A60$/);

  for (const code of ["NO-PACKET-9348", "5201345"]) {
    await page.goto("/blades?q=" + code);
    await expect(page.getByRole("link", { name: /EDG-Z71/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Ask us to match this blade" }).click();
    await expect(page.getByRole("textbox", { name: "Your search" })).toHaveValue(code);
  }
});

test("Variant isolation", async ({ page, db }) => {
  await db.query("update public.variants set stock_on_hand = 15 where sku = 'EDG-MIM-A60'");
  try {
    await chooseBlade(page, mimaki + "?variant=EDG-MIM-A45", 4);
    await chooseBlade(page, mimaki + "?variant=EDG-MIM-A60", 4);
    await expect(selection(page).getByRole("listitem")).toHaveCount(2);
    await expect(selection(page).getByText("4 × £11.95 = £47.80 ex VAT")).toHaveCount(2);
    const recipient = await review(page);
    const sessionCount = (await providerSessions()).sessions.length;
    await db.query("update public.variants set stock_on_hand = 0 where sku = 'EDG-MIM-A60'");
    await paymentButton(page).click();
    await expect(summary(page)).toContainText("EDG-MIM-A60 is out of stock and was removed from your basket.");
    await expect(summary(page)).toContainText("EDG-MIM-A45");
    await expect(paymentButton(page)).toBeDisabled();
    await summary(page).getByRole("button", { name: "Accept changes" }).click();
    await expect(summary(page).getByRole("listitem")).toHaveCount(1);
    await expect(paymentButton(page)).toBeEnabled();
    expect((await providerSessions()).sessions).toHaveLength(sessionCount);
    await page.goto(mimaki + "?variant=EDG-MIM-A60");
    const sold = page.getByRole("button", { name: /60°.*Out of stock/i });
    await expect(sold).toBeEnabled();
    await expect(sold).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Add to basket" })).toBeDisabled();
    await expect(page.getByRole("table", { name: "Price breaks per blade for EDG-MIM-A60" })).toContainText("£11.95");
    await expect(page.getByText(/removed from your basket/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "45°", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "45°", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add to basket" })).toBeEnabled();
    const orderCount = await db.query("select count(*)::int as count from public.orders where email = $1", [recipient]);
    expect(orderCount.rows[0].count).toBe(0);
  } finally {
    await db.query("update public.variants set stock_on_hand = 1 where sku = 'EDG-MIM-A60'");
  }
});

test("Price and tax", async ({ browser, db }) => {
  await db.query(`
    select private.apply_stock_movement('receive', 'receive:acceptance-price-and-tax', id, 60, 0)
    from public.variants where sku='EDG-Z10'
  `);
  const cases = [
    { quantity: 1, unit: 2250, goods: 2250, delivery: 695, vat: 589, gross: 3534 },
    { quantity: 4, unit: 2250, goods: 9000, delivery: 695, vat: 1939, gross: 11634 },
    { quantity: 5, unit: 1995, goods: 9975, delivery: 695, vat: 2134, gross: 12804 },
    { quantity: 9, unit: 1995, goods: 17955, delivery: 0, vat: 3591, gross: 21546 },
    { quantity: 10, unit: 1750, goods: 17500, delivery: 0, vat: 3500, gross: 21000 },
  ];
  for (const { quantity, unit, goods, delivery, vat, gross } of cases) {
    await test.step(`Z10 × ${quantity}`, async () => {
      const page = await browser.newPage();
      try {
        await chooseBlade(page, z10, quantity);
        const line = `${quantity} × ${gbp(unit)} = ${gbp(goods)} ex VAT`;
        await expect(selection(page)).toContainText(line);
        await expect(selection(page)).toContainText(gbp(gross));
        if (quantity === 9) await expect(selection(page)).toContainText("Add one blade and save £4.55 ex VAT");
        await review(page);
        await expect(summary(page)).toContainText(line);
        await expect(summary(page)).toContainText(gbp(vat));
        await expect(summary(page)).toContainText(gbp(gross));
        if (quantity > 1) {
          await page.route(`**${sessionPath}`, (route) => {
            const body = route.request().postDataJSON();
            const variantId = body.lines[0].variantId;
            expect(body.lines).toEqual([{ variantId, quantity }]);
            return route.continue({ postData: { ...body, lines: [{ variantId, quantity: 1 }, { variantId, quantity: quantity - 1 }] } });
          }, { times: 1 });
        }
        const session = await payByCard(page);
        expect(session.amount_total).toBe(gross);
        expect(session.lines).toHaveLength(delivery ? 2 : 1);
        expect(session.lines[0]).toMatchObject({ name: expect.stringContaining(`${quantity} × EDG-Z10`), amount: goods + Math.round(goods / 5) });
        if (delivery) expect(session.lines[1]).toMatchObject({ name: "Delivery · Next working day", amount: 834 });
        const invoice = await capture(session.id);
        expect(invoice).toMatchObject({ total: gross, currency: "gbp" });
        expect(invoice.footer).toContain(`Subtotal ex VAT: ${gbp(goods + delivery)}\nVAT (20%): ${gbp(vat)}\nTotal including VAT: ${gbp(gross)}`);
        expect(invoice.lines.data.map(({ amount }) => amount)).toEqual(session.lines.map(({ amount }) => amount));
        await event(page.request, "invoice.finalized", invoice.id);
        await visitSuccess(page, session);
        await expect(summary(page)).toContainText(gbp(gross));
        expect(invoice.footer).toContain(`Edgey order ${await receiptReference(page)}`);
        const items = await db.query("select sku,quantity,unit_price_pence,net_pence from public.order_items where order_id=$1", [session.client_reference_id]);
        expect(items.rows).toEqual([{ sku: "EDG-Z10", quantity, unit_price_pence: unit, net_pence: goods }]);
      } finally {
        await page.close();
      }
    });
  }

  const { rows: [original] } = await db.query("select price_1_4_pence from public.variants where sku = 'EDG-Z1'");
  try {
    for (const [net, delivery, lineCount] of [[14999, "£6.95", 2], [15000, "Free", 1]] as const) {
      const page = await browser.newPage();
      try {
        await db.query("update public.variants set price_1_4_pence = $1 where sku = 'EDG-Z1'", [net]);
        await chooseBlade(page, "/blades/edg-z1");
        await review(page);
        await expect(summary(page)).toContainText(gbp(net));
        await expect(summary(page).locator("dt").filter({ hasText: /^Delivery ex VAT$/ }).locator("+ dd")).toHaveText(delivery);
        const session = await payByCard(page);
        expect(session.lines).toHaveLength(lineCount);
        expect(session.amount_total).toBe(net + Math.round(net / 5) + (lineCount === 2 ? 834 : 0));
        await expire(session.id);
        await event(page.request, "checkout.session.expired", session.id);
      } finally {
        await page.close();
      }
    }
  } finally {
    await db.query("update public.variants set price_1_4_pence = $1 where sku = 'EDG-Z1'", [original.price_1_4_pence]);
  }
});

test("Guest purchase", async ({ page, db, request }) => {
  await chooseBlade(page, z10, 5);
  const recipient = await review(page);
  const session = await payByCard(page);
  const { requests } = await providerSessions();
  const params = new URLSearchParams(requests.find(({ sessionId }) => sessionId === session.id)?.body);
  expect(params.get("allowed_payment_method_types[0]")).toBe("card");
  expect(params.get("invoice_creation[enabled]")).toBe("true");
  expect(params.get("payment_intent_data[shipping][name]")).toBe("Alex Morgan");
  expect(params.get("payment_intent_data[shipping][address][postal_code]")).toBe("SW1A 1AA");
  await page.goto(session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id));
  await expect(page.getByRole("heading", { name: "Confirming payment" })).toBeVisible();
  await scanBothThemes(page);
  const invoice = await capture(session.id);
  await event(request, "checkout.session.completed", session.id);
  await drainEmails(request);
  await visitSuccess(page, session);
  await scanBothThemes(page);
  const reference = await receiptReference(page);
  expect(reference).toMatch(/^EDG-[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{4}-[2-9A-HJ-NP-TV-Z]{5}$/);
  expect(reference).not.toBe(session.client_reference_id);
  expect((await confirmation(recipient)).text).toContain(invoice.hosted_invoice_url);
  expect((await confirmation(recipient)).subject).toContain(reference);
  const snapshot = () => db.query(`
    select o.updated_at, o.paid_pence, r.state, m.state as email_state, m.updated_at as email_updated_at
    from public.orders o join public.stock_reservations r on r.order_id = o.id
    join public.order_outbox m on m.order_id = o.id where o.id = $1
  `, [session.client_reference_id]);
  const before = await snapshot();
  expect(before.rows).toHaveLength(1);
  expect(before.rows[0]).toMatchObject({ paid_pence: 12804, state: "allocated", email_state: "sent" });
  await page.reload();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
  await drainEmails(request);
  expect((await snapshot()).rows).toEqual(before.rows);
  expect((await confirmation(recipient)).text).toContain("£128.04");

  await pickList(page, session.client_reference_id, reference);
  const lines = page.getByRole("table", { name: "Pick lines" });
  await expect(lines.getByRole("cell", { name: "EDG-Z10", exact: true })).toHaveCount(2);
  await expect(lines.getByRole("cell", { name: "5", exact: true })).toBeVisible();
  await expect(page.getByText("Alex Morgan", { exact: true })).toBeVisible();
  await expect(page.getByText("Next working day", { exact: true })).toBeVisible();
});

test("Concurrent stock and provider retries", async ({ page, browser, db, request }) => {
  const sku = "EDG-MIM-A60";
  const other = await browser.newPage();
  try {
    await Promise.all([chooseBlade(page, mimaki + "?variant=" + sku), chooseBlade(other, mimaki + "?variant=" + sku)]);
    await Promise.all([review(page), review(other)]);
    const submissions = await Promise.all([checkoutPayload(page), checkoutPayload(other)]);
    const submit = (body: (typeof submissions)[number]) => request.post(sessionPath, { data: body });
    await dropNextCreateResponse();
    const answers = await Promise.all(submissions.map(submit));
    expect(answers.map((response) => response.status()).sort()).toEqual([200, 409]);
    const [winning, losing] = answers[0]!.ok() ? submissions : [submissions[1], submissions[0]];
    const first = await answers.find((response) => response.ok())!.json();
    const order = (await providerSessions()).sessions.find(({ id }) => id === first.sessionId)!;
    const repeated = await Promise.all([submit(winning), submit(winning)]);
    for (const retry of repeated) expect(await retry.json()).toEqual(first);
    expect((await providerSessions()).requests.filter(({ sessionId }) => sessionId === first.sessionId))
      .toEqual([expect.objectContaining({ key: `edgey:checkout:v1:${order.client_reference_id}`, count: 2 })]);
    const balance = () => db.query("select (stock_on_hand - stock_reserved) as available from public.variants where sku=$1", [sku]);
    expect((await balance()).rows[0].available).toBe(0);
    await event(request, "checkout.session.expired", first.sessionId);
    expect((await balance()).rows[0].available).toBe(0);
    await expire(first.sessionId);
    await event(request, "checkout.session.expired", first.sessionId);
    expect((await balance()).rows[0].available).toBe(1);
    const cancelled = await db.query("select fulfilment_status from public.orders where id=$1", [order.client_reference_id]);
    expect(cancelled.rows[0].fulfilment_status).toBe("cancelled");

    const next = await submit(losing);
    expect(next.status(), await next.text()).toBe(200);
    const { sessionId } = await next.json();
    const invoice = await capture(sessionId);
    const orderId = (await providerSessions()).sessions.find(({ id }) => id === sessionId)!.client_reference_id;
    const delivered = await event(request, "invoice.finalized", invoice.id);
    await Promise.all([
      event(request, "invoice.finalized", invoice.id, delivered),
      event(request, "checkout.session.expired", sessionId),
      event(request, "checkout.session.completed", sessionId),
      event(request, "checkout.session.completed", sessionId),
    ]);
    await Promise.all([drainEmails(request), drainEmails(request)]);
    const effect = await db.query(`
      select o.payment_status, o.fulfilment_status, r.state, r.quantity,
        (select count(*)::int from public.orders where checkout_attempt_token=o.checkout_attempt_token) as orders,
        (select count(*)::int from public.order_outbox where order_id=o.id and message_key='order_confirmation' and state='sent') as confirmations
      from public.orders o join public.stock_reservations r on r.order_id=o.id where o.id=$1
    `, [orderId]);
    expect(effect.rows).toEqual([{ payment_status: "paid", fulfilment_status: "ready_to_pick", state: "allocated", quantity: 1, orders: 1, confirmations: 1 }]);
    await confirmation(losing.fields.email);
    expect((await balance()).rows[0].available).toBe(0);
  } finally {
    await other.close();
  }
});

test("Isolation and trials", async ({ db, page, browser, request }) => {
  const [buyer, other] = await Promise.all([createLocalAdminUser("buyer"), createLocalAdminUser("buyer")]);
  const { available } = await createAccountCatalogue(db);
  const order = (user: typeof buyer) => createAccountOrder(db, {
    buyerId: user.id, email: user.email, state: "dispatched", createdAt: "2026-07-07T14:29:00Z", invoice: true,
    lines: [{ id: available.id, sku: available.sku, label: available.label, quantity: 1, price: 2350 }],
  });
  const [mine, theirs] = await Promise.all([order(buyer), order(other)]);
  const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  expect((await client.auth.signInWithPassword({ email: buyer.email, password: buyer.password })).error).toBeNull();
  const rows = await client.from("order_items").select("order_id,sku,quantity").in("order_id", [mine.id, theirs.id]);
  expect(rows).toMatchObject({ error: null, data: [{ order_id: mine.id, sku: available.sku, quantity: 1 }] });
  expect((await client.rpc("get_own_buyer_invoice_url", { p_order_id: mine.id })).data).toBe(mine.invoiceUrl);
  expect((await client.rpc("get_own_buyer_invoice_url", { p_order_id: theirs.id })).data).toBeNull();

  const [catalogue, warehouse] = await Promise.all([createLocalAdminUser("catalogue"), createLocalAdminUser("warehouse")]);
  const company = "Acceptance Trial Studio";
  const recipient = email();
  await page.goto("/sample-pack");
  const form = page.getByRole("main").locator("form");
  await expect(form.getByRole("textbox")).toHaveCount(4);
  await expect(form.getByRole("combobox")).toHaveCount(1);
  await form.getByLabel("Machine brand").selectOption({ label: "Zünd" });
  await form.getByLabel("OEM code").fill("3910110");
  await form.getByLabel("Work email").fill(recipient);
  await form.getByLabel("Company").fill(company);
  await form.getByLabel("Postcode").fill("SW1A1AA");
  await form.getByRole("button", { name: "Request trial blades" }).click();
  await expect(page.getByRole("heading", { name: "Trial request received" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("No delivery has been arranged");

  await signInStaff(page, catalogue);
  await page.goto("/admin/requests");
  await page.getByRole("table", { name: "Trial requests", exact: true }).getByRole("link", { name: company }).click();
  await expect(page.getByRole("heading", { name: "Trial request", exact: true })).toBeVisible();
  const trialPath = new URL(page.url()).pathname;
  const trialId = trialPath.split("/").at(-1);
  const balance = async () => (await db.query("select id,stock_on_hand,stock_reserved from public.variants where sku = 'EDG-Z1'")).rows[0];
  const stock = await balance();
  await expect(page.getByRole("button", { name: "Record dispatch" })).toHaveCount(0);
  await page.getByLabel("First blade unit").selectOption(stock.id);
  await page.getByLabel("Second blade unit").selectOption(stock.id);
  await page.getByLabel("Eligibility reason").fill("Confirmed matching holder.");
  await page.getByRole("button", { name: "Record eligible decision" }).click();
  await expect(page.getByRole("table", { name: "Trial blade units" })).toContainText("EDG-Z1");
  expect(await balance()).toEqual(stock);
  await signOutFromStaffMenu(page);
  await expect(page).toHaveURL("/admin/sign-in");
  await signInStaff(page, warehouse);
  await page.goto(trialPath);
  await expect(page.getByRole("button", { name: "Record dispatch" })).toHaveCount(0);
  await page.getByLabel("Recipient name").fill("Alex Morgan");
  await page.getByLabel("Address line 1").fill("10 Sample Street");
  await page.getByLabel("Town or city").fill("London");
  await page.getByLabel("Delivery postcode").fill("HS1 2AA");
  await page.getByLabel("Carrier", { exact: true }).fill("Fixture Carrier");
  await page.getByLabel("Carrier service", { exact: true }).fill("Tracked service");
  await page.getByLabel("I verified that this carrier service").check();
  await page.getByRole("button", { name: "Approve and reserve two units" }).click();
  await expect(page.getByLabel("Delivery postcode")).toHaveAccessibleDescription(/outside configured coverage/);
  await expect(page.getByRole("button", { name: "Record dispatch" })).toHaveCount(0);
  expect(await balance()).toEqual(stock);

  await page.getByLabel("Delivery postcode").fill("SW1A1AA");
  await page.getByLabel("I verified that this carrier service").check();
  await page.getByRole("button", { name: "Approve and reserve two units" }).click();
  await expect(page.getByText("Approved · two units reserved")).toBeVisible();
  await expect(page.getByText("10 Sample Street, London, SW1A 1AA, United Kingdom")).toBeVisible();
  expect(await balance()).toEqual({ ...stock, stock_reserved: stock.stock_reserved + 2 });
  await page.getByLabel("Tracking number").fill("ACCEPTANCE-TRIAL");
  await page.getByRole("button", { name: "Record dispatch" }).click();
  await expect(page.getByRole("heading", { name: "Link a subsequent order" })).toBeVisible();
  expect(await balance()).toEqual({ ...stock, stock_on_hand: stock.stock_on_hand - 2 });
  await drainEmails(request, "request-emails");
  await drainEmails(request, "request-emails");
  const notices = await messagesTo(recipient);
  expect(notices).toHaveLength(3);
  expect(notices.filter(({ subject }) => subject.includes("approved"))).toHaveLength(1);
  expect(notices.filter(({ text }) => text.includes("Tracking number: ACCEPTANCE-TRIAL"))).toHaveLength(1);
  expect(notices.filter(({ text }) => text.includes("Confirmed matching holder."))).toHaveLength(0);

  const customer = await browser.newPage();
  try {
    await chooseBlade(customer, "/blades/edg-z1");
    await review(customer, { email: recipient, postcode: "SW1A 1AA" });
    const session = await payByCard(customer);
    await capture(session.id);
    await event(request, "checkout.session.completed", session.id);
    await visitSuccess(customer, session);
    const reference = await receiptReference(customer);
    await page.reload();
    const suggested = page.getByRole("table", { name: "Possible subsequent orders" }).getByRole("row").filter({ hasText: reference });
    await expect(suggested).toContainText("Order contact email");
    await suggested.getByRole("link", { name: "Use this order" }).click();
    await expect(page.getByRole("textbox", { name: "Order reference" })).toHaveValue(reference);
    await page.getByLabel("I confirmed this order followed the trial").check();
    await page.getByRole("button", { name: "Link order" }).click();
    await page.getByRole("link", { name: reference, exact: true }).click();
    await expect(page.getByRole("link", { name: "View trial request" })).toHaveAttribute("href", trialPath);
    expect((await db.query("select subsequent_order_id from public.trial_fulfilments where trial_request_id=$1", [trialId])).rows)
      .toEqual([{ subsequent_order_id: session.client_reference_id }]);
  } finally {
    await customer.close();
  }
});

test("Delivery promises", async ({ browser, page, request }) => {
  const cases = [
    { at: "2026-07-07T14:29:00Z", dispatch: "2026-07-07", delivery: "2026-07-08", words: "Tuesday 7 July" },
    { at: "2026-07-07T14:30:00Z", dispatch: "2026-07-08", delivery: "2026-07-09", words: "Wednesday 8 July" },
    { at: "2026-07-10T14:29:00Z", dispatch: "2026-07-10", delivery: "2026-07-13", words: "Friday 10 July" },
    { at: "2026-08-31T14:29:00Z", dispatch: "2026-09-01", delivery: "2026-09-02", words: "Tuesday 1 September" },
  ];
  await signInWarehouse(page);
  for (const { at, dispatch, delivery, words } of cases) {
    await test.step(at, async () => {
      await dispatchAt(at);
      const buyer = await browser.newPage();
      try {
        await chooseBlade(buyer, z10);
        const recipient = await review(buyer);
        await expect(summary(buyer).locator("dt").filter({ hasText: /^Dispatch$/ }).locator("+ dd")).toHaveText(words);
        await expect(summary(buyer).locator("dt").filter({ hasText: /^Service$/ }).locator("+ dd")).toHaveText("Next working day");
        const session = await payByCard(buyer);
        await capture(session.id, at);
        await event(request, "checkout.session.completed", session.id);
        await visitSuccess(buyer, session);
        const written = words.replace(" ", ", ") + " " + dispatch.slice(0, 4);
        await expect(buyer.locator(`time[datetime="${dispatch}"]`)).toHaveText(written);
        await expect(buyer.locator(`time[datetime="${delivery}"]`)).toBeVisible();
        await expect(buyer.getByText("Next working day", { exact: true })).toBeVisible();
        await drainEmails(request);
        const mail = await confirmation(recipient);
        expect(mail.text).toContain(`Promised dispatch: ${written}`);
        expect(mail.text).toContain("Delivery service: Next working day");
        await page.goto(`/admin/warehouse/${session.client_reference_id}`);
        await page.getByRole("link", { name: "Printable pick list" }).click();
        await expect(page.locator(`time[datetime="${dispatch}"]`)).toBeVisible();
        await expect(page.getByText("Next working day", { exact: true })).toBeVisible();
      } finally {
        await buyer.close();
      }
    });
  }
  await chooseBlade(page, z10);
  await review(page, { email: email(), postcode: "BT1 5GS" });
  const count = (await providerSessions()).sessions.length;
  await expect(paymentButton(page)).toBeDisabled();
  await page.getByRole("link", { name: "Ask us about delivery" }).click();
  await expect(page).toHaveURL(/\/enquiry\?kind=delivery&postcode=BT1%205GS$/);
  await expect(page.getByLabel("Postcode")).toHaveValue("BT1 5GS");
  expect((await providerSessions()).sessions).toHaveLength(count);
});

test("Weekend staging — exact packet to confirmation and dispatch; only one buyer can buy the last blade", async ({ page, browser, db, request }) => {
  const sku = "EDG-MIM-A45";
  await db.query("update public.variants set stock_on_hand=1 where sku=$1", [sku]);
  const other = await browser.newPage();
  try {
    await Promise.all([page, other].map(async (buyer) => {
      await buyer.goto("/?q=edg%20mim-a45");
      const exact = buyer.getByRole("link", { name: /EDG-MIM-45/ });
      await expect(exact).toHaveAccessibleDescription(/Exact match · EDG-MIM-A45/);
      await exact.click();
      await expect(buyer.getByRole("button", { name: "45°", exact: true })).toHaveAttribute("aria-pressed", "true");
      await addBlade(buyer);
    }));
    const [emailA, emailB] = await Promise.all([review(page), review(other)]);
    const [a, b] = await Promise.all([checkoutPayload(page), checkoutPayload(other)]);
    const replies = await Promise.all([a, b].map((body) => request.post(sessionPath, { data: body })));
    expect(replies.map((reply) => reply.status()).sort()).toEqual([200, 409]);
    const won = replies.findIndex((reply) => reply.ok());
    const buyer = won === 0 ? page : other;
    const { sessionId, url } = await replies[won]!.json();
    const session = (await providerSessions()).sessions.find(({ id }) => id === sessionId)!;
    await stubHostedPayment(buyer);
    await buyer.goto(url);
    await buyer.getByRole("button", { name: "Pay with test card" }).click();
    await capture(sessionId);
    await event(request, "checkout.session.completed", sessionId);
    await drainEmails(request);
    await visitSuccess(buyer, session);
    const reference = await receiptReference(buyer);
    expect((await confirmation(won === 0 ? emailA : emailB)).text).toContain(`${sku} — 45°: 1 × £11.95`);
    await pickList(buyer, session.client_reference_id, reference);
    const lines = buyer.getByRole("table", { name: "Pick lines" });
    await expect(lines.getByRole("cell", { name: sku, exact: true })).toHaveCount(2);
    await expect(lines.getByRole("cell", { name: "1", exact: true })).toBeVisible();
    await buyer.getByRole("link", { name: "Back to order" }).click();
    await buyer.getByRole("button", { name: "Start picking" }).click();
    await buyer.getByLabel("Carrier").fill("Fixture Carrier");
    const tracking = "ACCEPTANCE-" + randomUUID().slice(0, 8);
    await buyer.getByLabel("Tracking number").fill(tracking);
    await buyer.getByRole("button", { name: "Record dispatch" }).click();
    await expect(buyer.getByText(tracking, { exact: true })).toBeVisible();
    const result = await db.query(`
      select o.fulfilment_status, o.tracking_number, i.sku, m.on_hand_delta, m.reserved_delta
      from public.orders o join public.order_items i on i.order_id=o.id
      join public.stock_movements m on m.order_id=o.id and m.kind='dispatch'
      where o.email in ($1,$2)
    `, [emailA, emailB]);
    expect(result.rows).toEqual([{ fulfilment_status: "dispatched", tracking_number: tracking, sku, on_hand_delta: -1, reserved_delta: -1 }]);
  } finally {
    await other.close();
  }
});

async function signInWarehouse(page: Page) {
  await signInStaff(page, await createLocalAdminUser("warehouse"));
}
