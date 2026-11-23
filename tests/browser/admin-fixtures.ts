import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { expect, type Page } from "@playwright/test";
import { localAdminClient } from "../../scripts/seed-admin";
import { authenticatorCode } from "../helpers/authenticator";

type StaffCredentials = { id: string; email: string; password: string };
const fixtureFactors = new Map<string, string>();

export async function enterStaffPassword(page: Page, credentials: StaffCredentials) {
  await page.goto("/admin");
  await page.getByLabel("Work email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function verifyNewStaffAuthenticator(page: Page) {
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const key = await page.locator(".admin-panel code").textContent();
  if (!key) throw new Error("No local authenticator setup key.");
  await page.getByLabel("Enter the 6-digit code from your authenticator app").fill(authenticatorCode(key.trim()));
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByText("Your authenticator is verified, but not approved for staff access.")).toBeVisible();
  const factorId = await page.locator(".admin-panel code").textContent();
  if (!factorId) throw new Error("No local authenticator ID.");
  return { factorId, key: key.trim() };
}

export async function activateStaffFactor(credentials: StaffCredentials, factorId: string) {
  const { error } = await localAdminClient().rpc("activate_staff_authenticator", {
    p_user_id: credentials.id, p_factor_id: factorId,
  });
  if (error) throw error;
}

export async function signInStaff(page: Page, credentials: StaffCredentials) {
  await enterStaffPassword(page, credentials);
  const key = fixtureFactors.get(credentials.id);
  if (key) {
    await page.getByLabel("Enter the 6-digit code from your authenticator app").fill(authenticatorCode(key));
    await page.getByRole("button", { name: "Verify code" }).click();
  } else {
    const factor = await verifyNewStaffAuthenticator(page);
    await activateStaffFactor(credentials, factor.factorId);
    fixtureFactors.set(credentials.id, factor.key);
    await page.goto("/admin");
  }
  await expect(page.getByRole("heading", { name: "Staff desk" })).toBeVisible();
}

export async function setVerifiedStaffSession(page: Page, credentials: StaffCredentials, baseURL: string | undefined) {
  const apiURL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const appURL = baseURL ?? "";
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (![apiURL, appURL].every((value) => ["127.0.0.1", "localhost"].includes(URL.parse(value)?.hostname ?? "")) || !apiKey) {
    throw new Error("Staff session fixtures require the local Edgey app and Supabase Auth API.");
  }
  const jar = new Map<string, string>();
  const client = createServerClient(apiURL, apiKey, {
    cookieOptions: { name: "edgey-auth" },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (updates) => {
        for (const { name, value } of updates) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { email, password } = credentials;
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const factor = await client.auth.mfa.enroll({ factorType: "totp" });
  if (factor.error) throw factor.error;
  const verified = await client.auth.mfa.challengeAndVerify({
    factorId: factor.data.id, code: authenticatorCode(factor.data.totp.secret),
  });
  if (verified.error) throw verified.error;
  await activateStaffFactor(credentials, factor.data.id);
  await page.context().addCookies([...jar].map(([name, value]) => ({
    name, value, url: appURL, httpOnly: true, sameSite: "Lax",
  })));
}

export async function seedPaidAdminOrder({
  mismatch = false, sku = "EDG-Z10", email = "warehouse-fixture@example.test", buyerId, service = "Next working day",
}: { mismatch?: boolean; sku?: string; email?: string; buyerId?: string; service?: string } = {}) {
  const db = localAdminClient();
  const { data: variant, error: variantError } = await db.from("variants")
    .select("id,sku,price_1_4_pence")
    .eq("sku", sku).single();
  if (variantError || !variant.price_1_4_pence) throw new Error("Apply the local staging fixture first.");
  const quantity = 2;
  const goods = variant.price_1_4_pence * quantity;
  const delivery = 695;
  const vat = Math.round(goods / 5) + Math.round(delivery / 5);
  const gross = goods + delivery + vat;
  const recipient = "Alex Test";
  const dispatchDate = "2026-11-24";
  const deliveryDate = "2026-11-25";
  const created = await db.rpc("create_order_with_reservations", {
    p_attempt_token: randomUUID(),
    p_lines: [{ variant_id: variant.id, quantity, unit_price_pence: variant.price_1_4_pence }],
    p_contact: { email, business_name: "Fixture Print Works",
      recipient_name: recipient, buying_for_work: true },
    ...(buyerId ? { p_buyer_id: buyerId } : {}),
    p_address: { line1: "1 Fixture Lane", town: "London", postcode: "SW1A 1AA", country: "GB" },
    p_totals: { goods_net_pence: goods, delivery_net_pence: delivery, vat_rate_bps: 2000,
      vat_pence: vat, gross_pence: gross },
    p_hold_expires_at: new Date(Date.now() + 40 * 60_000).toISOString(),
    p_delivery_service: service,
    p_dispatch_date: dispatchDate,
    p_delivery_date: deliveryDate,
  });
  if (created.error) throw created.error;
  const captured = await db.rpc("confirm_payment", {
    p_order_id: created.data.id, p_session_id: `cs_test_${randomUUID()}`, p_payment_intent_id: `pi_${randomUUID()}`,
    p_amount_pence: gross + Number(mismatch), p_currency: "gbp", p_paid_at: new Date().toISOString(),
    p_dispatch_date: dispatchDate, p_delivery_date: deliveryDate,
  });
  if (captured.error) throw captured.error;
  expect(captured.data.fulfilment_status).toBe(mismatch ? "awaiting_authorisation" : "ready_to_pick");
  return { id: created.data.id, reference: created.data.order_reference,
    paymentIntent: captured.data.payment_intent_id, gross, variant, quantity, recipient, service };
}
