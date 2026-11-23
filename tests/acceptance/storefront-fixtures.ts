import { openStaffMenu } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { Client } from "pg";
import Stripe from "stripe";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { signInStaff } from "../browser/admin-fixtures";

export const selection = (page: Page) => page.getByRole("dialog", { name: "Your basket" });
export const summary = (page: Page) => page.getByRole("region", { name: "Order summary" });
export const paymentButton = (page: Page) => page.getByRole("button", { name: "Continue to payment" });
export const sessionPath = "/api/checkout/session";
export const email = () => `acceptance-${randomUUID()}@example.test`;
export async function dispatchAt(iso: string) {
  const path = process.env.ACCEPTANCE_CLOCK_FILE!;
  await writeFile(path + ".next", iso);
  await rename(path + ".next", path);
}

type Line = { variantId: string; quantity: number };
type Checkout = { attemptToken: string; quoteKey: string; lines: Line[]; fields: { email: string } };
type StripeSession = {
  id: string; status: string; url: string; success_url: string; client_reference_id: string; amount_total: number;
  lines: { name: string; amount: number; quantity: number; description: string }[];
};
type Invoice = {
  id: string; total: number; currency: string; footer: string; hosted_invoice_url: string;
  lines: { data: { amount: number; quantity: number; description: string }[] };
};

export async function database() {
  const url = new URL(process.env.SUPABASE_DB_URL!);
  if (url.hostname !== "127.0.0.1" || !url.port || url.port !== process.env.ACCEPTANCE_DB_PORT || url.search) {
    throw new Error("This suite requires its isolated local database.");
  }
  const db = new Client({ connectionString: url.href, statement_timeout: 8000 });
  await db.connect();
  return db;
}

export async function chooseBlade(page: Page, path: string, quantity = 1) {
  await page.goto(path);
  await addBlade(page, quantity);
}

export async function addBlade(page: Page, quantity = 1) {
  const quantityField = page.getByRole("spinbutton", { name: "Quantity", exact: true });
  await quantityField.fill(String(quantity));
  await page.getByRole("button", { name: "Add to basket" }).click();
  await expect(selection(page).getByRole("link", { name: "Go to checkout" })).toBeVisible();
}

export async function review(page: Page, address = { email: email(), postcode: "SW1A 1AA" }) {
  await selection(page).getByRole("link", { name: "Go to checkout" }).click();
  await page.getByLabel("Business name").fill("Acceptance Print Studio");
  await page.getByLabel("Contact email").fill(address.email);
  await page.getByLabel("I’m buying for work").check();
  await page.getByLabel("Recipient name").fill("Alex Morgan");
  await page.getByLabel("Address line 1").fill("10 Sample Street");
  await page.getByLabel("Town or city").fill("London");
  await page.getByLabel("Postcode").fill(address.postcode);
  if (address.postcode === "SW1A 1AA") {
    await expect(summary(page)).toContainText("Next working day");
    await expect(paymentButton(page)).toBeEnabled();
  }
  return address.email;
}

export async function checkoutPayload(page: Page) {
  let body: Checkout | undefined;
  await page.route(`**${sessionPath}`, async (route) => {
    body = route.request().postDataJSON();
    await route.abort();
  }, { times: 1 });
  await paymentButton(page).click();
  await expect.poll(() => body).toBeDefined();
  return body!;
}

export async function payByCard(page: Page) {
  const result = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === sessionPath);
  await stubHostedPayment(page);
  await paymentButton(page).click();
  const response = await result;
  if (!response.ok()) throw new Error(`Checkout returned ${response.status()}: ${await response.text()}`);
  await expect(page).toHaveURL(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_[A-Za-z0-9]+$/);
  await page.getByRole("button", { name: "Pay with test card" }).click();
  const session = (await providerSessions()).sessions.find(({ url }) => url === page.url());
  expect(session).toBeDefined();
  return session!;
}

export async function stubHostedPayment(page: Page) {
  await page.route("https://checkout.stripe.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: '<button type="button">Pay with test card</button>' }));
}

async function provider<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(process.env.ACCEPTANCE_STRIPE_URL + "/fixture/" + path, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json();
}

export const providerSessions = () =>
  provider<{ sessions: StripeSession[]; requests: { key: string; sessionId: string; body: string; count: number }[] }>("sessions");
export const capture = (id: string, iso = "2026-07-07T14:29:00Z") =>
  provider<Invoice>("capture/" + id, { created: Date.parse(iso) / 1000 });
export const expire = (id: string) => provider("expire/" + id, {});
export const dropNextCreateResponse = () => provider("drop-next-create", {});

export async function event(api: APIRequestContext, type: string, id: string, eventId = "evt_" + randomUUID().replaceAll("-", "")) {
  const payload = JSON.stringify({ id: eventId, object: "event", type, livemode: false, data: { object: { id } } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  const response = await api.post("/api/webhooks/stripe", {
    data: Buffer.from(payload),
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
  expect(response.status(), await response.text()).toBe(200);
  return eventId;
}

export async function visitSuccess(page: Page, session: StripeSession) {
  await page.goto(session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id));
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
}

export async function drainEmails(api: APIRequestContext, queue: "order-confirmations" | "request-emails" = "order-confirmations") {
  const response = await api.get("/api/cron/" + queue, {
    headers: { authorization: "Bearer " + process.env.CRON_SECRET },
  });
  expect(response.status(), await response.text()).toBe(200);
}

export async function messagesTo(recipient: string) {
  const directory = process.env.EMAIL_OUTBOX_DIR!;
  const messages = await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".json"))
    .map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8")) as { to: string[]; subject: string; text: string }));
  return messages.filter(({ to }) => to.includes(recipient));
}

export async function confirmation(recipient: string) {
  const matching = await messagesTo(recipient);
  expect(matching).toHaveLength(1);
  return matching[0]!;
}

export async function pickList(page: Page, orderId: string, reference: string) {
  await signInStaff(page, await createLocalAdminUser("warehouse"));
  await (await openStaffMenu(page)).getByRole("link", { name: "New sales orders" }).click();
  await page.getByRole("link", { name: reference, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/warehouse/${orderId}$`));
  await page.getByRole("link", { name: "Printable pick list" }).click();
}

export function receiptReference(page: Page) {
  const reference = page.locator("dt").filter({ hasText: /^Order reference$/ }).locator("+ dd");
  return reference.innerText();
}
