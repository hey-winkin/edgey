import { switchTheme } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { scanAccessibility, scanBothThemes } from "../helpers/accessibility";
import type { Client } from "pg";
import {
  accountEmail,
  connectAccountDb,
  createAccountBuyer,
  createAccountCatalogue,
  createAccountOrder,
} from "../helpers/account-fixture";

test.use({ trace: "off" });

const inbox = "http://127.0.0.1:54324";
const selectionKey = "edgey-storefront-selection-v1";
const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 640 }];
const themes = ["dark", "light"] as const;
const orderPath = (id: string) => `/account/orders/${id}`;
const isAccount = (url: URL) => url.pathname === "/account";
const orderLink = (page: Page, reference: string) => page.getByRole("link", { name: `View order ${reference}`, exact: true });
const signInHeading = (page: Page) => page.getByRole("heading", { name: "Sign in to your account", level: 1 });
const accountHeading = (page: Page) => page.getByRole("heading", { name: "Your account", level: 1 });
const emailField = (page: Page) => page.getByRole("textbox", { name: "Email address", exact: true });
const reorderButton = (page: Page) => page.getByRole("button", { name: "Reorder", exact: true });
const reorderPreview = (page: Page) => page.getByRole("region", { name: "Review reorder", exact: true });

async function focusByKeyboard(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await target.evaluate((node) => document.activeElement === node && node.matches(":focus-visible"))) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect(target).toHaveCSS("outline-style", "solid");
  await expect(target).toHaveCSS("outline-width", /^[1-9]\d*px$/);
  await expect(target).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
}

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.locator('summary[aria-label="Edgey shop menu"]').click();
  await page.getByRole("navigation", { name: "Shop navigation" }).getByRole("link", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(isAccount);
  await expect(signInHeading(page)).toBeVisible();
  await focusByKeyboard(page, emailField(page));
  await emailField(page).fill(email);
  await page.getByRole("button", { name: "Send sign-in link", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const search = new URL("/api/v1/search", inbox);
  search.searchParams.set("query", "to:" + email);
  const authOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321").origin;
  let link = "";
  await expect.poll(async () => {
    const response = await fetch(search);
    if (!response.ok) return false;
    const { messages } = await response.json() as { messages?: { ID: string }[] };
    const first = messages?.[0];
    if (!first) return false;
    const message = await fetch(new URL("/api/v1/message/" + first.ID, inbox));
    if (!message.ok) return false;
    const { HTML } = await message.json() as { HTML: string };
    for (const [, href] of HTML.matchAll(/href="([^"]+)"/g)) {
      const candidate = URL.parse(href?.replaceAll("&amp;", "&") ?? "");
      if (candidate?.origin === authOrigin && candidate.pathname === "/auth/v1/verify") {
        link = candidate.href;
        return true;
      }
    }
    return false;
  }, { message: "The local inbox receives the account sign-in link", timeout: 10_000 }).toBe(true);
  if (!link) throw new Error("The local inbox did not return the verification link.");
  await Promise.all([
    page.waitForRequest((request) => new URL(request.url()).pathname === "/auth/confirm"),
    page.goto(link, { waitUntil: "domcontentloaded" }),
  ]);
  await expect(page).toHaveURL(isAccount);
  await expect(accountHeading(page)).toBeVisible();
}

async function seedHistory(db: Client, email: string) {
  await db.query("begin");
  try {
    const { rows: [buyer] } = await db.query<{ id: string }>(`
      select id from auth.users where email = $1 and email_confirmed_at is not null and not is_anonymous
    `, [email]);
    if (!buyer) throw new Error("The email link did not produce a verified buyer.");
    const foreignBuyer = await createAccountBuyer(db);
    const catalogue = await createAccountCatalogue(db);
    const { available, soldOut, selected } = catalogue;
    const oneLine = [{ ...available, quantity: 1, price: 2200 }];
    const owned = { buyerId: buyer.id, email, lines: oneLine };
    const pending = await createAccountOrder(db, { ...owned, state: "pending", createdAt: "2026-11-16T10:00:00Z" });
    const refunded = await createAccountOrder(db, { ...owned, state: "refunded", createdAt: "2026-11-15T10:00:00Z" });
    const dispatched = await createAccountOrder(db, {
      ...owned, state: "dispatched", createdAt: "2026-11-17T10:00:00Z", invoice: true,
      lines: [{ ...available, quantity: 2, price: 2100 }, { ...soldOut, quantity: 1, price: 1800 }],
    });
    const foreign = await createAccountOrder(db, {
      buyerId: foreignBuyer.id, email: foreignBuyer.email, state: "dispatched", createdAt: "2026-11-18T09:00:00Z",
      lines: [{ ...selected, quantity: 1, price: 2000 }], invoice: true,
    });
    const guest = await createAccountOrder(db, {
      buyerId: null, email, state: "dispatched", createdAt: "2026-11-18T10:00:00Z",
      lines: [{ ...selected, quantity: 1, price: 2100 }],
    });
    const applicationId = randomUUID();
    await db.query(`
      select public.submit_trade_application(
        $1, $2, 'Test Buyer', 'Account Test Studio', '12 Test Lane', 'London', 'SW1A 1AA'
      )
    `, [applicationId, buyer.id]);
    await db.query("commit");
    return { pending, refunded, dispatched, foreign, guest, foreignBuyer, catalogue, applicationId };
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function cleanUpHistory(db: Client, email: string, fixture?: Awaited<ReturnType<typeof seedHistory>>) {
  await db.query("begin");
  try {
    if (fixture) {
      const { pending, refunded, dispatched, foreign, guest, catalogue } = fixture;
      const orders = [pending.id, refunded.id, dispatched.id, foreign.id, guest.id];
      const variants = [catalogue.available.id, catalogue.soldOut.id, catalogue.selected.id];
      await db.query("delete from public.trade_applications where id = $1", [fixture.applicationId]);
      await db.query("delete from public.order_items where order_id = any($1::uuid[])", [orders]);
      await db.query("delete from public.orders where id = any($1::uuid[])", [orders]);
      await db.query("delete from public.stock_movements where variant_id = any($1::uuid[])", [variants]);
      await db.query("delete from public.variants where id = any($1::uuid[])", [variants]);
      await db.query("delete from public.products where id = $1", [catalogue.productId]);
    }
    await db.query("delete from auth.users where email = any($1::text[])", [
      [email, ...(fixture ? [fixture.foreignBuyer.email] : [])],
    ]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function setTheme(page: Page, theme: "light" | "dark") {
  const html = page.locator("html");
  if (await html.getAttribute("data-theme") !== theme) {
    await switchTheme(page, theme);
  }
  await expect(html).toHaveAttribute("data-theme", theme);
}

async function expectViewportFits(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
}

test("verified buyers can read and reorder their history without exposing foreign or guest orders", async ({ page }) => {
  test.setTimeout(120_000);
  const db = await connectAccountDb();
  const email = accountEmail();
  let fixture: Awaited<ReturnType<typeof seedHistory>> | undefined;
  try {
    await test.step("Verify a buyer through the local email and shared Auth callback", async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signIn(page, email);
      await expect(page.getByText("No trade application submitted.")).toBeVisible();
    });
    fixture = await seedHistory(db, email);
    const { pending, refunded, dispatched, foreign, guest, catalogue, applicationId, foreignBuyer } = fixture;
    const oldSelection = { [catalogue.selected.id]: 3 };
    await page.evaluate(({ key, oldSelection }) => localStorage.setItem(key, JSON.stringify(oldSelection)), {
      key: selectionKey, oldSelection,
    });
    await page.reload();

    await test.step("List only this buyer’s orders, newest first with readable references", async () => {
      const orders = page.getByRole("region", { name: "Orders", exact: true });
      const ownOrders = [dispatched, pending, refunded];
      const displayed = orders.getByRole("link", { name: /^View order / });
      await expect(displayed).toHaveText(ownOrders.map((order) => order.reference));
      for (const [index, { id }] of ownOrders.entries()) await expect(displayed.nth(index)).toHaveAttribute("href", orderPath(id));
      const rows = orders.getByRole("listitem");
      const statuses = [["Paid", "Dispatched"], ["Payment pending", "Awaiting confirmation"], ["Refunded", "Cancelled"]];
      for (const [index, terms] of statuses.entries()) {
        for (const term of terms) await expect(rows.nth(index).getByText(term, { exact: true })).toBeVisible();
      }
      for (const order of [foreign, guest]) await expect(orderLink(page, order.reference)).toHaveCount(0);
    });

    await test.step("Show the application decision without implying that approval grants credit", async () => {
      const trade = page.getByRole("region", { name: "Trade account", exact: true });
      await expect(trade.getByRole("heading", { name: "Application pending", exact: true })).toBeVisible();
      await scanBothThemes(page);
      await db.query(`
        update public.trade_applications
        set status = 'rejected', reviewed_at = now(), reviewed_by = $2
        where id = $1
      `, [applicationId, foreignBuyer.id]);
      await page.reload();
      await expect(trade.getByRole("heading", { name: "Application not approved", exact: true })).toBeVisible();
      await expect(trade.getByText("Available credit", { exact: true })).toHaveCount(0);
      await db.query("update public.trade_applications set status = 'approved' where id = $1", [applicationId]);
      await page.reload();
      await expect(trade.getByRole("heading", { name: "Application approved", exact: true })).toBeVisible();
      for (const text of ["Available credit", "Outstanding balance", "Invoices and PO references"]) {
        await expect(trade.getByText(text, { exact: true })).toBeVisible();
      }
      await expect(trade.getByText("Not available yet", { exact: true })).toHaveCount(3);
    });

    await test.step("Show the historical items, dispatch, tracking and invoice only where applicable", async () => {
      await orderLink(page, dispatched.reference).click();
      await expect(page).toHaveURL(orderPath(dispatched.id));
      await expect(page.getByText(dispatched.reference, { exact: true })).toBeVisible();
      const items = page.getByRole("region", { name: "Order items", exact: true });
      await expect(items.getByRole("heading", { name: "Order items", exact: true })).toBeVisible();
      await expect(items.getByRole("listitem").filter({ hasText: catalogue.available.sku })).toContainText("£21.00");
      await expect(items.getByText(catalogue.soldOut.sku, { exact: true })).toBeVisible();
      const delivery = page.getByRole("region", { name: "Delivery", exact: true });
      await expect(delivery.getByRole("heading", { name: "Delivery", exact: true })).toBeVisible();
      for (const text of [
        "Dispatch date", "18 Nov 2026", "Estimated delivery", "19 Nov 2026",
        "Carrier", "Fixture Parcel Service", "Tracking number", "EDGEY-TEST-7246",
      ]) await expect(delivery.getByText(text, { exact: true })).toBeVisible();
      await expect(delivery.getByRole("link", { name: "View invoice" })).toHaveAttribute("href", dispatched.invoiceUrl!);
      await expect(page.getByRole("main")).not.toContainText(dispatched.providerInvoiceId!);
      await scanBothThemes(page);
      for (const order of [pending, refunded]) {
        await page.goto(orderPath(order.id));
        await expect(page.getByRole("heading", { name: "Order items", exact: true })).toBeVisible();
        await expect(page.getByText("Not dispatched", { exact: true })).toBeVisible();
        for (const text of ["Estimated delivery", "Carrier", "Tracking number"]) {
          await expect(page.getByText(text, { exact: true })).toHaveCount(0);
        }
        await expect(page.getByRole("link", { name: "View invoice" })).toHaveCount(0);
      }
    });

    await test.step("Foreign, guest and unknown detail URLs have the same not-found response", async () => {
      for (const id of [foreign.id, guest.id, randomUUID(), dispatched.reference]) {
        expect((await page.goto(orderPath(id)))?.status()).toBe(404);
        await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Order items", exact: true })).toHaveCount(0);
        await expect(page.getByRole("link", { name: "View invoice" })).toHaveCount(0);
      }
    });

    await test.step("A dual-role finance buyer still sees only their own buyer history", async () => {
      await db.query(`
        insert into public.staff_members (user_id, role) select id, 'finance' from auth.users where email = $1
      `, [email]);
      await page.goto("/account");
      const orders = page.getByRole("region", { name: "Orders", exact: true });
      await expect(orders.getByRole("link", { name: /^View order / })).toHaveText([dispatched.reference, pending.reference, refunded.reference]);
      expect((await page.goto(orderPath(foreign.id)))?.status()).toBe(404);
      await expect(page.getByRole("link", { name: "View invoice" })).toHaveCount(0);
    });

    const renders = process.env.EDGEY_ACCOUNT_RENDERS;
    if (renders) await mkdir(renders, { recursive: true });
    await test.step("List, detail and reorder fit with visible keyboard focus in both themes and at all three widths", async () => {
      for (const theme of themes) {
        for (const viewport of viewports) {
          const { width } = viewport;
          const capture = async (view: string) => {
            if (!renders) return;
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: join(renders, `${view}-${theme}-${width}.png`), fullPage: true });
          };
          await page.setViewportSize(viewport);
          await page.goto("/account");
          await setTheme(page, theme);
          await expect(accountHeading(page)).toBeVisible();
          await expectViewportFits(page, width);
          await capture("list");
          const link = orderLink(page, dispatched.reference);
          await focusByKeyboard(page, link);
          await page.keyboard.press("Enter");
          await expect(page).toHaveURL(orderPath(dispatched.id));
          await expect(page.getByRole("heading", { name: "Order items", exact: true })).toBeVisible();
          await expectViewportFits(page, width);
          await capture("detail");
          await focusByKeyboard(page, reorderButton(page));
          await page.keyboard.press("Enter");
          const preview = reorderPreview(page);
          await expect(preview.getByRole("heading", { name: "Review reorder" })).toBeFocused();
          await expectViewportFits(page, width);
          if (width === 1440) await scanAccessibility(page, theme);
          await capture("reorder");
          await focusByKeyboard(page, preview.getByRole("button", { name: "Cancel", exact: true }));
          await page.keyboard.press("Enter");
          await expect(preview).toHaveCount(0);
          await expect(reorderButton(page)).toBeFocused();
        }
      }
      await page.addStyleTag({ content: "html { font-size: 125% }" });
      await expectViewportFits(page, 320);
    });

    await test.step("Review current prices and stock; cancel preserves the selection and replace keeps only the available line", async () => {
      await reorderButton(page).press("Enter");
      const preview = reorderPreview(page);
      const unavailable = preview.getByRole("listitem").filter({ hasText: catalogue.soldOut.sku });
      await expect(unavailable).toContainText(/Out of stock/i);
      const repriced = preview.getByRole("listitem").filter({ hasText: catalogue.available.sku });
      await expect(repriced).toContainText(/price changed from £21\.00 to £23\.50/i);
      await expect(preview).toContainText("Confirming will replace every item in your current basket.");
      await expect(page.getByRole("button", { name: "Basket 3 blades" })).toBeVisible();
      await preview.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
      await expect(preview).toHaveCount(0);
      const readSelection = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), selectionKey);
      expect(await readSelection()).toEqual(oldSelection);
      await reorderButton(page).press("Enter");
      const replace = preview.getByRole("button", { name: "Replace basket", exact: true });
      await expect(replace).toBeEnabled();
      const otherTab = await page.context().newPage();
      try {
        await otherTab.goto("/account");
        await otherTab.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify({ [id]: 4 })), {
          key: selectionKey, id: catalogue.selected.id,
        });
        await expect(replace).toBeDisabled();
        await expect(preview.getByRole("status")).toContainText("Your basket changed");
      } finally {
        await otherTab.close();
      }
      await reorderButton(page).press("Enter");
      await expect(replace).toBeEnabled();
      await replace.press("Enter");
      await expect(preview).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Basket 2 blades" })).toBeVisible();
      await expect.poll(readSelection).toEqual({ [catalogue.available.id]: 2 });
      await page.getByRole("button", { name: "Basket 2 blades" }).click();
      const selection = page.getByRole("dialog", { name: "Your basket" });
      await expect(selection).toContainText("2 × £23.50");
      await expect(selection).toContainText(catalogue.available.sku);
      await expect(selection).not.toContainText(catalogue.soldOut.sku);
      await expect(selection).not.toContainText(catalogue.selected.sku);
    });

    await test.step("Sign out and redirect private details to the sign-in form, which also fits both themes", async () => {
      await page.goto("/account");
      await page.getByRole("button", { name: "Sign out", exact: true }).press("Enter");
      await expect(signInHeading(page)).toBeVisible();
      await page.goto(orderPath(dispatched.id));
      await expect(page).toHaveURL(isAccount);
      await expect(signInHeading(page)).toBeVisible();
      for (const theme of themes) {
        for (const viewport of viewports) {
          await page.setViewportSize(viewport);
          await page.goto("/account");
          await setTheme(page, theme);
          await expect(signInHeading(page)).toBeVisible();
          await expectViewportFits(page, viewport.width);
          await focusByKeyboard(page, emailField(page));
          if (renders) await page.screenshot({ path: join(renders, `signin-${theme}-${viewport.width}.png`), fullPage: true });
        }
      }
    });
  } finally {
    try {
      await cleanUpHistory(db, email, fixture);
    } finally {
      await db.end();
    }
  }
});
