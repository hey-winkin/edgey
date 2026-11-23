import { openStaffMenu, switchTheme } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser, localAdminClient } from "../../scripts/seed-admin";
import { formatGbp } from "../../src/lib/commerce";
import { deleteStripeEventFixtures } from "../fixtures/stripe-events";
import { scanAccessibility } from "../helpers/accessibility";
import { seedPaidAdminOrder, signInStaff } from "./admin-fixtures";

test("finance sees cancellation without a refund and the separate flagged payment review", async ({ page }) => {
  const db = localAdminClient();
  const warehouse = await createLocalAdminUser("warehouse");
  const finance = await createLocalAdminUser("finance");
  const cancelled = await seedPaidAdminOrder({ sku: "EDG-Z50" });
  const mismatch = await seedPaidAdminOrder({ sku: "EDG-Z50", mismatch: true });
  const result = await db.rpc("cancel_order", {
    p_actor_id: warehouse.id, p_order_id: cancelled.id, p_operation_key: randomUUID(),
  });
  if (result.error) throw result.error;
  try {
    await signInStaff(page, finance);
    await (await openStaffMenu(page)).getByRole("link", { name: "Finance and trade accounts", exact: true }).click();
    const captures = page.getByRole("table", { name: "Outstanding captures" });
    await expect(captures.getByRole("row").filter({ hasText: cancelled.reference })).toContainText(formatGbp(cancelled.gross));
    await expect(captures.getByRole("row").filter({ hasText: cancelled.reference })
      .locator("summary").filter({ hasText: /^Verify or refund remaining capture$/ })).toBeVisible();
    const reasons = page.getByRole("table", { name: "Payment review" });
    await expect(reasons.getByRole("row").filter({ hasText: mismatch.reference })).toContainText("Payment amount or currency mismatch");
    const orders = page.getByRole("table", { name: "Orders and payment status" });
    const order = orders.getByRole("row").filter({ hasText: cancelled.reference });
    await expect(order.getByRole("cell", { name: "Paid", exact: true })).toBeVisible();
    await expect(order.getByRole("cell", { name: "Cancelled", exact: true })).toBeVisible();
    if (process.env.EDGEY_NET30_RENDERS) {
      await captures.screenshot({ path: join(process.env.EDGEY_NET30_RENDERS, "finance-card-refund.png") });
    }
  } finally {
    const resolved = await db.rpc("resolve_refunded_payment_review", {
      p_actor_id: finance.id, p_order_id: mismatch.id, p_payment_intent_id: mismatch.paymentIntent!,
      p_refund_id: `re_${randomUUID().replaceAll("-", "")}`,
    });
    if (resolved.error) throw resolved.error;
  }
});

test("warehouse separates releasing an allocation from a card refund", async ({ page }) => {
  const db = localAdminClient();
  const warehouse = await createLocalAdminUser("warehouse");
  const order = await seedPaidAdminOrder({ sku: "EDG-Z50" });
  const refund = await db.rpc("record_refund", {
    p_order_id: order.id, p_refund_id: `re_${randomUUID().replaceAll("-", "")}`,
    p_payment_intent_id: order.paymentIntent!, p_currency: "gbp", p_amount_pence: order.gross,
  });
  if (refund.error) throw refund.error;
  try {
    await signInStaff(page, warehouse);
    await page.goto("/admin/warehouse");
    await page.getByRole("link", { name: /payment-blocked orders?/ }).click();
    await expect(page.getByText("Do not pick or dispatch these orders.", { exact: false })).toBeVisible();
    await expect(page.getByRole("table", { name: "Payment blocks" }).getByRole("row")
      .filter({ hasText: order.reference })).toContainText("Refunded");
    if (process.env.EDGEY_NET30_RENDERS) {
      await page.screenshot({ path: join(process.env.EDGEY_NET30_RENDERS, "warehouse-payment-block.png"), fullPage: true });
    }
    await page.getByRole("link", { name: order.reference, exact: true }).click();
    const release = page.locator("summary").filter({ hasText: /^Cancel and release allocation$/ });
    await release.click();
    await page.getByLabel("I confirm the order has not left the warehouse").check();
    await page.getByRole("button", { name: "Confirm cancel and release allocation" }).click();
    await expect(page.getByText("Fulfilment cancelled and the allocation released.", { exact: false })).toBeVisible();
    const { data, error } = await db.from("orders").select("fulfilment_status,payment_status").eq("id", order.id).single();
    if (error) throw error;
    expect(data).toEqual({ fulfilment_status: "cancelled", payment_status: "refunded" });
  } finally {
    const cancel = await db.rpc("cancel_order", {
      p_actor_id: warehouse.id, p_order_id: order.id, p_operation_key: randomUUID(),
    });
    if (cancel.error) throw cancel.error;
  }
  await page.goto("/admin/warehouse?view=blocked");
  await expect(page.getByRole("link", { name: order.reference })).toHaveCount(0);
  await page.getByRole("link", { name: "Past sales orders" }).click();
  await expect(page.getByRole("row").filter({ hasText: order.reference })).toContainText("Not dispatched");
});

test("finance queues failed Stripe events and confirmations for the scheduled workers", async ({ page }) => {
  const db = localAdminClient();
  const id = `evt_${randomUUID().replaceAll("-", "")}`;
  const order = await seedPaidAdminOrder({ sku: "EDG-SR6223" });
  const { data, error } = await db.from("orders").select("order_reference").eq("id", order.id).single();
  if (error) throw error;
  const recorded = await db.rpc("record_provider_event", {
    p_provider: "stripe", p_event_id: id, p_event_type: "checkout.session.completed", p_payload: { fixture: true },
  });
  if (recorded.error) throw recorded.error;
  try {
    const eventFailed = await db.rpc("mark_provider_event", {
      p_provider: "stripe", p_event_id: id, p_state: "failed", p_error: "Fixture needs replay",
    });
    const messageFailed = await db.from("order_outbox").update({ state: "failed" }).eq("order_id", order.id);
    if (eventFailed.error || messageFailed.error) throw eventFailed.error ?? messageFailed.error;
    await signInStaff(page, await createLocalAdminUser("finance"));
    await page.goto("/admin/finance");
    const event = page.getByRole("table", { name: "Failed provider events" }).getByRole("row").filter({ hasText: id });
    const message = page.getByRole("table", { name: "Order email outbox" }).getByRole("row").filter({ hasText: data.order_reference });
    await expect(message).toContainText("Confirmation");
    await event.getByRole("button", { name: "Reprocess event" }).click();
    await expect(event).toContainText("Retry queued.");
    await message.getByRole("button", { name: "Resend confirmation" }).click();
    await expect(message).toContainText("Retry queued.");
    await page.reload();
    await expect(message).toContainText("Retry queued.");
    await expect(event).toContainText("Fixture needs replay");
    await expect(message.getByRole("cell", { name: "Failed", exact: true })).toBeVisible();
  } finally {
    await deleteStripeEventFixtures([id], order.id);
  }
});

test("dispatch mail status and Finance outbox remain usable across widths and themes", async ({ page }) => {
  test.setTimeout(90_000);
  const db = localAdminClient();
  const staff = await createLocalAdminUser("warehouse");
  const order = await seedPaidAdminOrder({ sku: "EDG-Z50" });
  const roles = await db.from("staff_members").insert({ user_id: staff.id, role: "finance" });
  if (roles.error) throw roles.error;
  const operation = { p_order_id: order.id, p_actor_id: staff.id };
  const picking = await db.rpc("start_picking", { ...operation, p_operation_key: randomUUID() });
  if (picking.error) throw picking.error;
  const dispatch = await db.rpc("dispatch_order", {
    ...operation, p_operation_key: randomUUID(), p_carrier: "Fixture Carrier", p_tracking_number: "FIXTURE-TRACK-281",
  });
  if (dispatch.error) throw dispatch.error;
  await signInStaff(page, staff);
  const renders = process.env.EDGEY_DISPATCH_RENDERS;
  if (renders) await mkdir(renders, { recursive: true });
  for (const [path, view, label] of [
    [`/admin/warehouse/${order.id}`, "warehouse", "Order status"],
    ["/admin/finance", "finance", "Order email outbox"],
  ] as const) {
    await page.goto(path);
    const section = page.getByRole("heading", { name: label, exact: true }).locator("..");
    if (view === "finance") {
      const rows = section.getByRole("row").filter({ hasText: order.reference });
      await expect(rows).toHaveCount(2);
      const dispatch = rows.filter({ has: page.getByRole("cell", { name: "Dispatch", exact: true }) });
      await expect(dispatch).toContainText("Queued");
      await expect(dispatch.getByRole("button")).toHaveCount(0);
    } else {
      await expect(section.getByText("Dispatch email", { exact: true }).locator("+ dd")).toHaveText("Queued");
    }
    for (const theme of ["light", "dark"] as const) {
      await switchTheme(page, theme);
      for (const width of [1440, 1280, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await scanAccessibility(page, theme);
        if (renders) await section.screenshot({ path: join(renders, `${view}-${theme}-${width}.png`) });
      }
    }
  }
});
