import { signOutFromStaffMenu } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createLocalAdminUser } from "../../scripts/seed-admin";
import { seedPaidAdminOrder, signInStaff } from "../browser/admin-fixtures";
import { createAccountCatalogue } from "../helpers/account-fixture";
import { addBlade, capture, database, event, payByCard, review } from "./storefront-fixtures";

test("records an exact match through card authorisation, dispatch and a structured wrong-fit return", async ({ page, browser, request }) => {
  const db = await database();
  const warehousePage = await browser.newPage({ baseURL: process.env.ACCEPTANCE_BASE_URL });
  try {
    const { available } = await createAccountCatalogue(db);
    await page.goto("/privacy");
    await expect(page.getByText(/random identifier for up to 30 minutes/)).toBeVisible();
    await page.getByRole("button", { name: "Turn on Finder analytics" }).click();
    await expect(page.getByRole("button", { name: "Turn off Finder analytics" })).toBeVisible();
    await page.goto("/blades");
    await page.getByRole("searchbox").fill(available.sku);
    const result = page.locator(".cards").getByRole("link", { name: /Account test blades/ });
    await expect(result).toHaveAccessibleDescription(/Exact match/);
    await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === "edgey-finder-match"))
      .toMatchObject({ path: "/api/checkout", sameSite: "Strict", value: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    await result.click();
    await addBlade(page);
    await review(page);
    const session = await payByCard(page);
    await capture(session.id);
    await event(request, "checkout.session.completed", session.id);
    const orderId = session.client_reference_id;
    const code = available.sku.replaceAll("-", "");
    expect((await db.query("select id from public.finder_search_events where normalised_query = $1", [code])).rowCount).toBe(1);
    expect((await db.query(`select e.normalised_query, o.authorised_at is not null as authorised
      from private.finder_order_attributions a join public.finder_search_events e on e.id = a.event_id
      join public.orders o on o.id = a.order_id where a.order_id = $1`, [orderId])).rows)
      .toEqual([{ normalised_query: code, authorised: true }]);

    await signInStaff(warehousePage, await createLocalAdminUser("warehouse"));
    await warehousePage.goto(`/admin/warehouse/${orderId}`);
    await warehousePage.getByRole("button", { name: "Start picking" }).click();
    await warehousePage.getByLabel("Carrier").fill("Fixture carrier");
    await warehousePage.getByLabel("Tracking number").fill("FIXTURE-PACKET-1");
    await warehousePage.getByRole("button", { name: "Record dispatch" }).click();
    await warehousePage.getByLabel("Dispatched line").selectOption(available.id);
    await warehousePage.getByLabel("Returned quantity").fill("1");
    await warehousePage.getByLabel("Return category").selectOption("wrong_fit");
    await warehousePage.getByLabel("Return reason").fill("Fixture return details");
    await warehousePage.getByRole("button", { name: "Record return", exact: true }).click();
    await expect(warehousePage.getByRole("article", { name: /Return/ })).toContainText(code);

    await warehousePage.goto("/admin/commercial");
    const report = warehousePage.getByRole("table", { name: "Wrong-fit returns by variant and lookup code" });
    await expect(report.getByRole("row").filter({ hasText: available.sku })).toContainText(code);
    await expect(warehousePage.getByText("Fixture return details")).toHaveCount(0);
    await warehousePage.screenshot({ path: test.info().outputPath("commercial-measures.png"), fullPage: true });

    await signOutFromStaffMenu(warehousePage);
    await expect(warehousePage).toHaveURL("/admin/sign-in");
    await warehousePage.goto("/admin/commercial");
    await expect(warehousePage.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    await page.goto("/privacy");
    await page.getByRole("button", { name: "Turn off Finder analytics" }).click();
    await expect(page.getByRole("button", { name: "Turn on Finder analytics" })).toBeVisible();
    expect((await page.context().cookies()).map(({ name }) => name)).not.toContain("edgey-finder-match");
  } finally {
    await warehousePage.close();
    await db.end();
  }
});

test("links truthful public shells and lists only published families in a fresh sitemap", async ({ page, request, baseURL }) => {
  const db = await database();
  try {
    const { productId } = await createAccountCatalogue(db);
    const { rows: [product] } = await db.query<{ slug: string }>("select slug from public.products where id = $1", [productId]);
    const path = `/blades/${product!.slug}`;
    const sitemap = async () => {
      const response = await request.get("/sitemap.xml");
      expect(response.ok()).toBe(true);
      return response.text();
    };
    expect(await sitemap()).toContain(`<loc>${baseURL}${path}</loc>`);
    expect(await sitemap()).not.toMatch(/checkout|admin|\?variant|\?q=|edg-htr040/);
    await db.query("update public.variants set publication_status = 'draft' where product_id = $1", [productId]);
    expect(await sitemap()).not.toContain(path);
    expect((await request.get(path)).status()).toBe(404);
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
    expect(robots).toContain("Disallow: /admin");

    await page.goto("/");
    const footer = page.getByRole("navigation", { name: "Footer" });
    await footer.getByRole("link", { name: "Contact" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Contact" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open an enquiry" })).toHaveAttribute("href", "/enquiry");
    await expect(page.locator("a[href^='mailto:']")).toHaveCount(0);
    await footer.getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    await expect(page.getByText("The privacy notice hasn’t been published on this site yet.")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("privacy-shell.png"), fullPage: true });

    await page.goto("/blades?q=3910301");
    await expect(page.locator(".p-card").filter({ hasText: "Exact match" }).getByRole("link")).toBeVisible();
    expect((await page.context().cookies()).map(({ name }) => name)).not.toContain("edgey-finder-match");
    const cutoff = (await db.query<{ since: Date }>("select clock_timestamp() as since")).rows[0]!.since;
    const bench = await request.get("/blades?q=3910301", { headers: { "User-Agent": "EdgeyBenchmarkBot/1.0" } });
    expect(await bench.text()).toContain("Exact match");
    for (const text of ["buyer-private@example.test", "198.51.100.24", "unknown personal note"]) {
      await page.goto(`/blades?q=${encodeURIComponent(text)}`);
      await expect(page.getByRole("heading", { name: /No verified match/ })).toBeVisible();
    }
    await expect.poll(async () => (await db.query(`select outcome, normalised_query, query_fingerprint
      from public.finder_search_events where created_at >= $1`, [cutoff])).rows).toEqual(
      Array.from({ length: 3 }, () => ({ outcome: "unmatched", normalised_query: null, query_fingerprint: null })),
    );
  } finally {
    await db.end();
  }
});

test("catalogue staff can add a draft without creating stock or fit claims", async ({ page, request }) => {
  const db = await database();
  try {
    await signInStaff(page, await createLocalAdminUser("catalogue"));
    await page.goto("/admin/catalogue");
    await page.getByRole("link", { name: "Add draft variant" }).click();
    const sku = `EDG-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
    await page.getByLabel("Product family").selectOption({ label: "EDG-HTR040 · Circular rotary blade" });
    await page.getByLabel("Edgey SKU").fill(sku);
    await page.getByLabel("Variant label (optional)").fill("Pilot test only");
    await page.getByLabel("1–4 blades (£ ex VAT)", { exact: true }).fill("12.05");
    await page.getByLabel("5–9 blades (£ ex VAT)", { exact: true }).fill("11");
    await page.getByLabel("10+ blades (£ ex VAT)", { exact: true }).fill("10.00");
    for (const vatInclusive of ["£14.46", "£13.20", "£12.00"]) {
      await expect(page.getByText(`${vatInclusive} inc VAT (20%)`)).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath("add-draft.png"), fullPage: true });
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/admin\/catalogue\/[a-f0-9-]{36}$/);
    expect((await db.query(`select publication_status, approved_at, stock_on_hand,
      price_1_4_pence, price_5_9_pence, price_10_plus_pence,
      (select count(*)::int from public.compatibility where variant_id = v.id) as mappings
      from public.variants v where sku = $1`, [sku])).rows)
      .toEqual([{
        publication_status: "draft", approved_at: null, stock_on_hand: 0, mappings: 0,
        price_1_4_pence: 1205, price_5_9_pence: 1100, price_10_plus_pence: 1000,
      }]);
    expect((await request.get("/blades/edg-htr040")).status()).toBe(404);
  } finally {
    await db.end();
  }
});

test("warehouse releases a fully refunded allocation without changing its payment outcome", async ({ page }) => {
  const db = await database();
  try {
    const order = await seedPaidAdminOrder({ sku: "EDG-SUM-DRG-36" });
    await db.query("select public.record_refund($1, $2, $3, $4, 'GBP')",
      [order.id, `re_test_${randomUUID()}`, order.paymentIntent, order.gross]);
    await signInStaff(page, await createLocalAdminUser("warehouse"));
    await page.goto("/admin/warehouse?view=blocked");
    await page.getByRole("link", { name: order.reference, exact: true }).click();
    await expect(page.getByRole("button", { name: "Start picking" })).toHaveCount(0);
    await page.locator("summary").filter({ hasText: /^Cancel and release allocation$/ }).click();
    await page.getByLabel("I confirm the order has not left the warehouse").check();
    await page.getByRole("button", { name: "Confirm cancel and release allocation" }).click();
    await expect(page.getByText("Fulfilment cancelled and the allocation released.", { exact: false })).toBeVisible();
    expect((await db.query(`select o.payment_status, o.fulfilment_status, o.refunded_pence = o.gross_pence as fully_refunded,
      (select count(*)::int from public.stock_movements where order_id = o.id and kind = 'release') as releases
      from public.orders o where id = $1`, [order.id])).rows)
      .toEqual([{ payment_status: "refunded", fulfilment_status: "cancelled", fully_refunded: true, releases: 1 }]);
  } finally {
    await db.end();
  }
});
