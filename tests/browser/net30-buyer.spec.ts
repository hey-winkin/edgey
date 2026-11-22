import { switchTheme } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb } from "../helpers/account-fixture";
import { scanBothThemes } from "../helpers/accessibility";
import { resetBrowserQuoteBudget } from "../helpers/quote-budget";
import { signInStaff } from "./admin-fixtures";

test.use({ trace: "off" });

const gateEnabled = process.env.NET30_CHECKOUT_ENABLED === "true";
const selectionKey = "edgey-storefront-selection-v1";
const attemptKey = "edgey-active-net30-v1";
const renders = process.env.EDGEY_NET30_RENDERS;
const reference = "PO-EST-431";
const pendingReference = "PO-EST-432";
const viewports = [[1440, 1000], [390, 844], [320, 640]] as const;
const submitByCard = (page: Page) => page.getByRole("button", { name: "Continue to payment" });
const payOnAccount = (page: Page) => page.getByRole("radio", { name: "Pay on account (Net 30)" });
const poField = (page: Page) => page.getByRole("textbox", { name: "Purchase order reference (required)" });
const confirmation = (id: string) => `/checkout/net30/${id}`;

async function stage() {
  const db = await connectAccountDb();
  const admin = localAdminClient();
  const buyer = await createLocalAdminUser("buyer");
  const other = await createLocalAdminUser("finance");
  const tradeId = randomUUID();
  const applicationId = randomUUID();
  const issued = randomUUID();
  const pending = randomUUID();
  const invoiceId = "in_" + issued.replaceAll("-", "");
  const hostedInvoice = "https://invoice.stripe.com/i/edgey_fixture_" + issued;
  async function clean() {
    try {
      await db.query("delete from public.invoices where trade_account_id = $1", [tradeId]);
      await db.query("delete from public.order_items where order_id in ($1, $2)", [issued, pending]);
      await db.query("delete from public.orders where trade_account_id = $1", [tradeId]);
      await db.query("delete from public.trade_accounts where id = $1", [tradeId]);
      await db.query("delete from public.trade_applications where id = $1", [applicationId]);
      await Promise.all([admin.auth.admin.deleteUser(buyer.id), admin.auth.admin.deleteUser(other.id)]);
    } finally {
      await db.end();
    }
  }
  try {
    const { rows: [variant] } = await db.query<{ id: string; sku: string; option_label: string | null }>(
      "select id,sku,option_label from public.variants where sku = 'EDG-Z10' and publication_status = 'published'",
    );
    if (!variant) throw new Error("Apply the local staging fixture first.");
    await db.query(
      "select public.submit_trade_application($1,$2,'Alex Morgan','Estuary Print Studio','10 Sample Street','London','SW1A 1AA')",
      [applicationId, buyer.id],
    );
    await db.query("select public.review_trade_application($1,$2,'approved')", [applicationId, other.id]);
    await db.query(`
      insert into public.trade_accounts (id, application_id, buyer_id, buyer_name, status, credit_limit_pence, stripe_customer_id)
      values ($1,$2,$3,'Alex Morgan','approved',30000,$4)
    `, [tradeId, applicationId, buyer.id, "cus_" + tradeId.replaceAll("-", "")]);
    for (const [id, po] of [[issued, reference], [pending, pendingReference]]) {
      await db.query(`
        insert into public.orders (
          id, checkout_attempt_token, trade_account_id, buyer_id, email, business_name, recipient_name, buying_for_work,
          address_line1, address_town, address_postcode, address_country, payment_method, po_number, goods_net_pence,
          delivery_net_pence, vat_rate_bps, vat_pence, gross_pence, hold_expires_at, delivery_service,
          promised_dispatch_date, estimated_delivery_date, created_at
        ) values ($1, $2, $3, $4, $5, 'Estuary Print Studio', 'Alex Morgan', true,
          '10 Sample Street', 'London', 'SW1A 1AA', 'GB', 'net30', $6, 9975, 695, 2000, 2134, 12804,
          now()+interval '35 minutes', 'Next working day', '2026-11-23', '2026-11-24', '2026-11-20T09:00:00Z')
      `, [id, randomUUID(), tradeId, buyer.id, buyer.email, po]);
      await db.query(`
        insert into public.order_items (order_id, variant_id, sku, option_label, quantity, unit_price_pence,
          net_pence, tax_pence, gross_pence) values ($1,$2,$3,$4,5,1995,9975,1995,11970)
      `, [id, variant.id, variant.sku, variant.option_label ?? ""]);
    }
    async function issue(id: string, po: string, remaining: number) {
      const provider = id === issued ? invoiceId : "in_" + id.replaceAll("-", "");
      const url = id === issued ? hostedInvoice : "https://invoice.stripe.com/i/edgey_fixture_" + id;
      await db.query(`
        update public.orders set fulfilment_status = 'ready_to_pick', payment_status = $4, authorised_at = now(),
          provider_invoice_id = $2, buyer_invoice_url = $3, paid_pence = 12804 - $5 where id = $1
      `, [id, provider, url, remaining === 12804 ? "invoiced" : "partially_paid", remaining]);
      await db.query(`
        insert into public.invoices (order_id, trade_account_id, provider_invoice_id, po_number, currency,
          amount_due_pence, amount_remaining_pence, issued_at, due_at, status)
        values ($1,$2,$3,$4,'GBP',12804,$5,'2026-11-20T09:00:00Z','2026-12-20T09:00:00Z',$6)
      `, [id, tradeId, provider, po, remaining, remaining === 12804 ? "open" : "partially_paid"]);
    }
    await issue(issued, reference, 8000);
    return { buyer, other, db, tradeId, variantId: variant.id, hostedInvoice, issued, pending, issue, clean };
  } catch (error) {
    await clean();
    throw error;
  }
}

async function signIn(page: Page, buyer: { email: string; password: string }) {
  const base = new URL(page.url());
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: "edgey-auth" },
    cookies: {
      getAll: async () => await page.context().cookies(base.origin),
      setAll: async (values) => {
        await page.context().addCookies(values.map(({ name, value }) => ({ name, value, url: base.origin, httpOnly: true })));
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: buyer.email, password: buyer.password });
  if (error) throw new Error("Could not sign in a local test buyer.");
}

async function checkout(page: Page, variantId: string) {
  await page.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify({ [id]: 5 })), { key: selectionKey, id: variantId });
  await page.goto("/checkout");
  await expect(page.getByRole("region", { name: "Order summary" })).toContainText("£128.04");
}

async function fillDelivery(page: Page) {
  await page.getByLabel("Business name").fill("Estuary Print Studio");
  await page.getByLabel("Contact email").fill("orders@example.test");
  await page.getByLabel("I’m buying for work").check();
  await page.getByLabel("Recipient name").fill("Alex Morgan");
  await page.getByLabel("Address line 1").fill("10 Sample Street");
  await page.getByLabel("Town or city").fill("London");
  await page.getByLabel("Postcode").fill("SW1A 1AA");
  await expect(page.getByRole("region", { name: "Order summary" })).not.toContainText("Delivery and the total are estimates");
}

async function capture(page: Page, name: string, theme: "dark" | "light", width: number, height: number) {
  await page.setViewportSize({ width, height });
  if (await page.locator("html").getAttribute("data-theme") !== theme) {
    await switchTheme(page, theme);
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  if (renders) {
    await mkdir(renders, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(renders, `${name}-${theme}-${width}.png`), fullPage: true, animations: "disabled",
      style: "nextjs-portal { visibility: hidden !important; }" });
  }
}

test("Net 30 confirmation and the trade panel read only the verified buyer's orders and invoices", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const fixture = await stage();
  try {
    await page.goto(confirmation(fixture.issued));
    await expect(page.getByRole("heading", { name: "Checkout not found" })).toBeVisible();
    await signIn(page, fixture.other);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Checkout not found" })).toBeVisible();
    await expect(page.getByText(reference)).toHaveCount(0);
    await page.goto("/account");
    await expect(page.getByText("No trade application submitted.")).toBeVisible();
    await expect(page.getByText(fixture.issued)).toHaveCount(0);
    await scanBothThemes(page);
    const staff = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const finance = await staff.newPage();
      await signInStaff(finance, fixture.other);
      await finance.goto(`/admin/finance/accounts/${fixture.tradeId}`);
      await expect(finance.getByRole("heading", { level: 1, name: "Estuary Print Studio" })).toBeVisible();
      await scanBothThemes(finance);
    } finally {
      await staff.close();
    }

    const owner = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const ownPage = await owner.newPage();
      await ownPage.goto("/account");
      await signIn(ownPage, fixture.buyer);
      await ownPage.reload();
      const trade = ownPage.getByRole("region", { name: "Trade account" });
      await expect(trade.getByRole("heading", { name: "Approved for Net 30" })).toBeVisible();
      await expect(trade.getByText("£220.00")).toBeVisible();
      await expect(trade.getByText("£80.00", { exact: true })).toBeVisible();
      await expect(trade.getByText("£80.00 remaining")).toBeVisible();
      await expect(trade.getByText("Partially paid · Due 20 Dec 2026")).toBeVisible();
      await expect(trade.getByRole("link", { name: `View invoice for PO ${reference}` })).toHaveAttribute("href", fixture.hostedInvoice);
      for (const theme of ["dark", "light"] as const) {
        for (const [width, height] of viewports) {
          await capture(ownPage, "trade-panel", theme, width, height);
        }
      }
      await scanBothThemes(ownPage);
      await trade.getByRole("link", { name: `View order for PO ${reference}` }).click();
      await expect(ownPage.getByText(reference, { exact: true })).toBeVisible();
      await expect(ownPage.getByRole("link", { name: "View invoice" })).toHaveAttribute("href", fixture.hostedInvoice);
      await scanBothThemes(ownPage);

      await ownPage.goto(confirmation(fixture.issued));
      await expect(ownPage.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
      await expect(ownPage.getByText("Total invoiced inc VAT")).toBeVisible();
      await expect(ownPage.getByText("Total paid inc VAT")).toHaveCount(0);
      await expect(ownPage.getByText(reference, { exact: true })).toBeVisible();
      await scanBothThemes(ownPage);
      for (const theme of ["dark", "light"] as const) {
        for (const [width, height] of viewports) {
          await capture(ownPage, "net30-confirmed", theme, width, height);
        }
      }
      await ownPage.goto(confirmation(fixture.pending));
      await expect(ownPage.getByRole("heading", { name: "Confirming your invoice" })).toBeVisible();
      await expect(ownPage.getByRole("region", { name: "Order summary" })).toHaveCount(0);
      await scanBothThemes(ownPage);
      if (renders) {
        await capture(ownPage, "net30-confirming", "dark", 320, 640);
        await capture(ownPage, "net30-confirming", "light", 390, 844);
      }
      await fixture.db.query("update public.orders set fulfilment_status = 'cancelled' where id = $1", [fixture.issued]);
      await ownPage.goto(confirmation(fixture.issued));
      await expect(ownPage.getByRole("heading", { name: "This account order was cancelled" })).toBeVisible();
      await expect(ownPage.getByText("Invoice status")).toBeVisible();
      await expect(ownPage.getByText("Partially paid", { exact: true })).toBeVisible();
      await expect(ownPage.getByText("Dispatch date")).toHaveCount(0);
      await expect(ownPage.getByRole("link", { name: "View invoice" })).toHaveCount(0);
      await scanBothThemes(ownPage);
      await fixture.db.query("update public.orders set authorised_at = null where id = $1", [fixture.issued]);
      await ownPage.reload();
      await expect(ownPage.getByRole("heading", { name: "Your account order is under review" })).toBeVisible();
      await expect(ownPage.getByText(/Please don’t pay the invoice or place the order again/)).toBeVisible();
      await expect(ownPage.getByRole("link", { name: "View invoice" })).toHaveCount(0);
      await scanBothThemes(ownPage);
    } finally {
      await owner.close();
    }
  } finally {
    await fixture.clean();
  }
});

test("the launch flag gates Net 30 and credit reasons leave card available", async ({ page }) => {
  const fixture = await stage();
  try {
    await resetBrowserQuoteBudget(fixture.db);
    await page.goto("/account");
    await signIn(page, fixture.other);
    await checkout(page, fixture.variantId);
    await expect(submitByCard(page)).toBeEnabled();
    if (!gateEnabled) {
      await expect(payOnAccount(page)).toHaveCount(0);
      return;
    }
    await expect(payOnAccount(page)).toBeDisabled();
    await expect(page.getByText("Your trade account isn’t approved for Net 30.")).toBeVisible();
    await scanBothThemes(page);

    await signIn(page, fixture.buyer);
    await page.reload();
    await expect(payOnAccount(page)).toBeEnabled();
    await fillDelivery(page);
    await expect(page.getByText("£220.00")).toBeVisible();
    await expect(page.getByText("Order total inc VAT", { exact: true })).toBeVisible();

    await fixture.db.query("update public.trade_accounts set credit_limit_pence = 20804 where id = $1", [fixture.tradeId]);
    await page.reload();
    await fillDelivery(page);
    await expect(payOnAccount(page)).toBeEnabled();
    await fixture.db.query("update public.trade_accounts set credit_limit_pence = 20803 where id = $1", [fixture.tradeId]);
    await page.reload();
    await fillDelivery(page);
    await expect(payOnAccount(page)).toBeDisabled();
    await expect(page.getByText("This order exceeds your available credit.")).toBeVisible();
    await expect(submitByCard(page)).toBeEnabled();
    await scanBothThemes(page);

    await fixture.db.query("update public.trade_accounts set status = 'suspended' where id = $1", [fixture.tradeId]);
    await page.reload();
    await expect(payOnAccount(page)).toBeDisabled();
    await expect(page.getByText("Your trade account is suspended for new orders.")).toBeVisible();
    await expect(submitByCard(page)).toBeEnabled();

    await fixture.db.query("update public.trade_accounts set status = 'approved', credit_limit_pence = 30000 where id = $1", [fixture.tradeId]);
    await page.reload();
    await fillDelivery(page);
    await payOnAccount(page).check();
    await expect(page.getByRole("region", { name: "Order summary" })).toContainText("Dates are provisional until your invoice is issued.");
    await poField(page).fill(pendingReference);
    await scanBothThemes(page);
    await page.route("**/api/checkout/net30", (route) => route.fulfill({
      status: 409, json: { status: "trade-unavailable", reason: "over-limit" },
    }));
    await page.getByRole("button", { name: "Place order on account" }).click();
    await expect(page.getByRole("radio", { name: "Card or wallet" })).toBeChecked();
    await expect(payOnAccount(page)).toHaveAccessibleDescription("This order exceeds your available credit.");
    await expect(submitByCard(page)).toBeEnabled();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), attemptKey)).toBeNull();
  } finally {
    await fixture.clean();
  }
});

test("an uncertain attempt blocks card across tabs until verified closure, then uses a different token", async ({ page, context }) => {
  test.skip(!gateEnabled, "Start the application with NET30_CHECKOUT_ENABLED=true.");
  const fixture = await stage();
  try {
    await page.goto("/account");
    await signIn(page, fixture.buyer);
    await checkout(page, fixture.variantId);
    await fillDelivery(page);
    await payOnAccount(page).check();
    const submit = page.getByRole("button", { name: "Place order on account" });
    await poField(page).fill("   ");
    await submit.click();
    await expect(poField(page)).toBeFocused();
    await expect(poField(page)).toHaveAttribute("aria-invalid", "true");
    await poField(page).fill(pendingReference);
    let token: string | undefined;
    let closed = false;
    await page.route("**/api/checkout/net30", async (route) => {
      const request = route.request().postDataJSON();
      if (!request.action) {
        expect(request.poReference).toBe(pendingReference);
        expect(request.lines).toEqual([{ variantId: fixture.variantId, quantity: 5 }]);
        token = request.attemptToken;
        await route.abort();
      } else {
        expect(request.attemptToken).toBe(token);
        await route.fulfill({ json: closed
          ? { status: "error", attemptClosed: true, message: "Closed" }
          : { status: "error", attemptPending: true, message: "Still checking this checkout." } });
      }
    });
    await submit.click();
    await expect(page.getByText("We couldn’t verify your account checkout. Check its status before placing another order.")).toBeVisible();
    expect(token).toBeTruthy();
    const stored = await page.evaluate((key) => localStorage.getItem(key), attemptKey);
    expect(stored).toContain(token!);
    expect(stored).not.toContain(pendingReference);
    expect(stored).not.toContain("orders@example.test");
    await page.reload();
    const secondTab = await context.newPage();
    await secondTab.goto("/checkout");
    await expect(secondTab.getByRole("heading", { name: "Account checkout in progress" })).toBeVisible();
    await expect(submitByCard(secondTab)).toHaveCount(0);
    await page.getByRole("button", { name: "Check account checkout" }).click();
    await expect(page.getByText("Still checking this checkout.")).toBeVisible();
    await expect(submitByCard(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Close account checkout" }).click();
    await expect(page.getByText("Still checking this checkout.")).toBeVisible();
    closed = true;
    await page.getByRole("button", { name: "Close account checkout" }).click();
    await expect(submitByCard(page)).toBeEnabled();
    await expect(submitByCard(secondTab)).toBeEnabled();
    await fillDelivery(page);
    let cardToken: string | undefined;
    await context.route("**/api/checkout/session", async (route) => {
      const request = route.request().postDataJSON();
      if (request.action === "close") {
        expect(request.attemptToken).toBe(cardToken);
        await route.fulfill({ json: { status: "closed" } });
      } else {
        cardToken = request.attemptToken;
        await route.fulfill({ json: { status: "error", attemptPending: true, message: "Fixture card response" } });
      }
    });
    await submitByCard(page).click();
    await expect(page.getByText("Fixture card response")).toBeVisible();
    expect(cardToken).toBeTruthy();
    expect(cardToken).not.toBe(token);
    await expect(payOnAccount(secondTab)).toBeDisabled();
    await secondTab.getByRole("button", { name: "Close previous checkout" }).click();
    await expect(payOnAccount(secondTab)).toBeEnabled();
    await expect(payOnAccount(page)).toBeEnabled();
  } finally {
    await fixture.clean();
  }
});

test("a confirming Net 30 order clears only the submitted selection after authorisation", async ({ page }) => {
  test.skip(!gateEnabled, "Start the application with NET30_CHECKOUT_ENABLED=true.");
  test.setTimeout(120_000);
  const fixture = await stage();
  try {
    await page.goto("/account");
    await signIn(page, fixture.buyer);
    await checkout(page, fixture.variantId);
    await fillDelivery(page);
    await payOnAccount(page).check();
    await poField(page).fill(pendingReference);
    if (renders) {
      for (const theme of ["dark", "light"] as const) {
        for (const [width, height] of viewports) {
          await capture(page, "net30-checkout", theme, width, height);
        }
      }
    }
    await page.route("**/api/checkout/net30", async (route) => {
      await route.fulfill({ json: { status: "confirming", orderId: fixture.pending } });
    });
    await page.getByRole("button", { name: "Place order on account" }).click();
    await expect(page).toHaveURL(confirmation(fixture.pending));
    await expect(page.getByRole("heading", { name: "Confirming your invoice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Basket 5 blades" })).toBeVisible();
    await fixture.issue(fixture.pending, pendingReference, 12804);
    await page.getByRole("button", { name: "Check invoice status" }).click();
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Basket 0 blades" })).toBeVisible();
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), attemptKey)).toBeNull();

    await checkout(page, fixture.variantId);
    await page.goto(confirmation(fixture.issued));
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Basket 5 blades" })).toBeVisible();
  } finally {
    await fixture.clean();
  }
});
