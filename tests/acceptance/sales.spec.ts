import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { setVerifiedStaffSession } from "../browser/admin-fixtures";
import { salesMoney } from "../../src/lib/sales/report";
import { database, dispatchAt } from "./storefront-fixtures";

test("staging demo orders feed the finance dashboard and cleanup restores stock", async ({ page, baseURL }) => {
  const db = await database();
  const balances = async () => (await db.query(
    "select id, stock_on_hand, stock_reserved from public.variants order by id",
  )).rows;
  const finance = await createLocalAdminUser("finance");
  const beforeStock = await balances();
  const beforeOrders = (await db.query("select id from public.orders order by id")).rows;
  const { rows: [range] } = await db.query<{ from: string; to: string }>(`
    select ((now() at time zone 'Europe/London')::date - 69)::text as "from",
      (now() at time zone 'Europe/London')::date::text as "to"
  `);
  const booked = async () => (await db.query<{ count: number; net: number }>(`
    select count(*)::int as count, coalesce(sum(goods_net_pence), 0)::int as net from public.orders
    where authorised_at is not null and fulfilment_status in ('ready_to_pick', 'picking', 'dispatched')
      and (authorised_at at time zone 'Europe/London')::date between $1 and $2
  `, [range!.from, range!.to])).rows[0]!;
  const beforeSales = await booked();
  const previousClock = await readFile(process.env.ACCEPTANCE_CLOCK_FILE!, "utf8");
  try {
    execFileSync("pnpm", ["demo:orders", "--local"], { stdio: ["ignore", "pipe", "pipe"] });
    expect(await balances()).not.toEqual(beforeStock);
    expect((await db.query("select id from public.orders order by id")).rows.length).toBeGreaterThan(beforeOrders.length);
    await setVerifiedStaffSession(page, finance, baseURL);
    const sales = await booked();
    expect(sales.count - beforeSales.count).toBe(12);
    await dispatchAt(new Date().toISOString());
    const query = new URLSearchParams({ period: "custom", ...range!, grain: "week" });
    await page.goto(`/admin/sales?${query}`);
    await expect(page.getByRole("heading", { name: "Sales reports", exact: true })).toBeVisible();
    const currentFigure = (label: RegExp) => page.locator("dt").filter({ hasText: label }).locator("..").locator("dd").first();
    await expect(currentFigure(/^Revenue ex VAT$/)).toHaveText(salesMoney(sales.net));
    await expect(currentFigure(/^Orders$/)).toHaveText(String(sales.count));
    await expect(page.getByRole("img", { name: /bar chart of booked product revenue/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment methods" }).locator("..")).toContainText("Net 30");
    await expect(page.getByRole("table", { name: "Product sales" })).toContainText("Cost missing");
    await page.getByText("How these figures are worked out").click();
    await expect(page.getByText(/free trial packs do not/)).toBeVisible();
    const exportUrl = (await page.getByRole("link", { name: "Download daily sales CSV" }).getAttribute("href"))!;
    const csv = await page.request.get(exportUrl);
    expect(csv.ok()).toBe(true);
    const [heading, ...days] = (await csv.text()).trim().split("\r\n");
    expect(heading).toContain('"Revenue ex VAT (GBP)"');
    expect(days).toHaveLength(70);
    expect(days.reduce((total, row) => total + Number(row.split(",")[1]?.replace(".", "")), 0)).toBe(sales.net);
  } finally {
    try {
      execFileSync("pnpm", ["demo:orders:clean", "--local"], { stdio: ["ignore", "pipe", "pipe"] });
      expect(await balances()).toEqual(beforeStock);
      expect((await db.query("select id from public.orders order by id")).rows).toEqual(beforeOrders);
    } finally {
      await dispatchAt(previousClock);
      await db.end();
    }
  }
});
