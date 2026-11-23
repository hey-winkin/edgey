import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { sep } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { localAdminClient } from "../../scripts/seed-admin";
import { connectAccountDb, createAccountCatalogue } from "../helpers/account-fixture";
import { scanAccessibility, themes, saveThemeBeforeLoad, type Theme } from "../helpers/accessibility";
import { seedPaidAdminOrder, signInStaff } from "./admin-fixtures";
import { company, withNet30Data } from "./fixtures/net30-data";

const noPage = "We could not find that page";
const product = "Flat-stock drag blade";

test("every App Router page is accounted for in the accessibility suite", () => {
  const pages = readdirSync("src/app", { recursive: true, encoding: "utf8" })
    .map((path) => path.split(sep).join("/"))
    .filter((path) => path === "page.tsx" || path.endsWith("/page.tsx"))
    .sort();
  expect(pages, "Add a route-state scan or record its existing coverage in the inventory").toEqual([
    "(shop)/@modal/(.)blades/[slug]/page.tsx",
    "(shop)/@modal/[...catchAll]/page.tsx",
    "(shop)/@modal/page.tsx",
    "(shop)/[...catchAll]/page.tsx",
    "(shop)/account/orders/[id]/page.tsx",
    "(shop)/account/page.tsx",
    "(shop)/blades/[slug]/page.tsx",
    "(shop)/blades/page.tsx",
    "(shop)/brands/[slug]/page.tsx",
    "(shop)/checkout/net30/[id]/page.tsx",
    "(shop)/checkout/page.tsx",
    "(shop)/checkout/success/page.tsx",
    "(shop)/contact/page.tsx",
    "(shop)/enquiry/page.tsx",
    "(shop)/page.tsx",
    "(shop)/preview/material-hero/page.tsx",
    "(shop)/preview/original-hero/page.tsx",
    "(shop)/privacy/page.tsx",
    "(shop)/reference-guide/page.tsx",
    "(shop)/sample-pack/page.tsx",
    "(shop)/trade/page.tsx",
    "admin/[...missing]/page.tsx",
    "admin/catalogue/[id]/page.tsx",
    "admin/catalogue/new/page.tsx",
    "admin/catalogue/page.tsx",
    "admin/commercial/page.tsx",
    "admin/delivery/page.tsx",
    "admin/finance/accounts/[id]/page.tsx",
    "admin/finance/page.tsx",
    "admin/page.tsx",
    "admin/purchase-orders/[id]/edit/page.tsx",
    "admin/purchase-orders/[id]/page.tsx",
    "admin/purchase-orders/[id]/print/page.tsx",
    "admin/purchase-orders/new/page.tsx",
    "admin/purchase-orders/page.tsx",
    "admin/purchase-orders/settings/page.tsx",
    "admin/purchase-orders/suppliers/[id]/page.tsx",
    "admin/purchase-orders/suppliers/new/page.tsx",
    "admin/purchase-orders/suppliers/page.tsx",
    "admin/requests/enquiries/[id]/page.tsx",
    "admin/requests/page.tsx",
    "admin/requests/trade/[id]/page.tsx",
    "admin/requests/trials/[id]/page.tsx",
    "admin/sales/page.tsx",
    "admin/sign-in/page.tsx",
    "admin/stock/[id]/page.tsx",
    "admin/stock/deliveries/[id]/page.tsx",
    "admin/stock/deliveries/page.tsx",
    "admin/stock/page.tsx",
    "admin/stock/receive/page.tsx",
    "admin/warehouse/[id]/page.tsx",
    "admin/warehouse/[id]/print/page.tsx",
    "admin/warehouse/page.tsx",
  ]);
});

async function scanRoutes(
  page: Page, theme: Theme, routes: readonly (readonly [string, string | RegExp, ("Sales orders" | "Purchasing" | "Admin")?])[],
  checkTitle = false,
) {
  for (const [url, heading, group] of routes) {
    await test.step(url, async () => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: typeof heading === "string" })).toBeVisible();
      if (checkTitle && typeof heading === "string") await expect(page).toHaveTitle(`${heading} | Edgey`);
      if (group) {
        await expect(page.locator(".admin-location")).toHaveText(group);
        await expect(page.locator(".admin-heading > [data-area-eyebrow]")).toBeHidden();
      }
      await scanAccessibility(page, theme);
    });
  }
}

async function expectFallbackTheme(context: BrowserContext, route: string, theme: Theme, status: 404 | 500) {
  const page = await context.newPage();
  try {
    await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, (request) => request.abort());
    await saveThemeBeforeLoad(page, theme);
    expect((await page.goto(route))?.status()).toBe(status);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("body")).toHaveCSS("background-color", theme === "light" ? "rgb(250, 250, 248)" : "rgb(20, 22, 23)");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", theme === "light" ? "#FAFAF8" : "#141617");
  } finally {
    await page.close();
  }
}

for (const theme of themes) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => saveThemeBeforeLoad(page, theme));

    test("public catalogue, fit details and not-found states", async ({ page }) => {
      await scanRoutes(page, theme, [
        ["/", "Find a blade."],
        ["/?q=3910301", "Find a blade."],
        ["/?material=vinyl", "Find a blade."],
        ["/preview/material-hero", "Find a blade by material."],
        ["/preview/material-hero?study=corrugated-board", "Corrugated board."],
        ["/preview/original-hero", "The cutting room."],
        ["/blades", "Blade catalogue"],
        ["/blades?q=spb%200030", "Blade catalogue"],
        ["/blades?q=no-such-reference", "Blade catalogue"],
        ["/blades?machine=zund&head=uct&depth=5", "Blade catalogue"],
        ["/reference-guide", "Blade cross-reference guide"],
        ["/blades/edg-z10", product],
        ["/blades/edg-mim-45", /Mimaki|drag blade/i],
        ["/brands/mimaki", "Mimaki blade references"],
        ["/brands/graphtec", noPage],
        ["/blades/edg-sum-drg?variant=EDG-SUM-DRG-60", "Summa-pattern drag plotter blade"],
        ["/blades/missing-blade", noPage],
        ["/blades/edg-z46", noPage],
        ["/missing-edgey-page", noPage],
      ]);
    });

    test("request forms, sign-ins and public checkout returns", async ({ page }) => {
      await scanRoutes(page, theme, [
        ["/enquiry", "Ask us to match this blade"],
        ["/enquiry?postcode=HS1%202AA", "Ask about delivery"],
        ["/sample-pack", "Request two trial blades"],
        ["/contact", "Contact"],
        ["/privacy", "Privacy"],
        ["/trade", "Apply for a trade account"],
        ["/account", "Sign in to your account"],
        ["/admin/sign-in", "Staff sign-in"],
        ["/admin/missing-staff-page", noPage],
        ["/checkout", "Checkout"],
        ["/checkout/success", "Checkout not found"],
        ["/checkout/net30/" + randomUUID(), "Checkout not found"],
      ]);
      await page.goto("/enquiry");
      await page.getByRole("button", { name: "Send enquiry" }).click();
      await expect(page.getByRole("heading", { name: "Check the form" })).toBeFocused();
      await scanAccessibility(page, theme);
    });

    test("product and selection dialogs, populated checkout and validation", async ({ page }) => {
      const tray = page.getByRole("dialog", { name: "Your basket" });
      await page.goto("/blades");
      await page.getByRole("button", { name: "Basket 0 blades" }).click();
      await expect(tray).toContainText("Your basket is empty");
      await scanAccessibility(page, theme);
      await page.keyboard.press("Escape");

      await page.getByRole("link", { name: /EDG-MIM-45/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("Choose the configuration");
      await scanAccessibility(page, theme);
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: /EDG-Z10 Flat-stock drag blade/ }).click();
      await expect(dialog).toContainText(product);
      await scanAccessibility(page, theme);
      await dialog.getByRole("button", { name: "Add to basket" }).click();
      await expect(tray.getByRole("button", { name: "Remove EDG-Z10" })).toBeVisible();
      await scanAccessibility(page, theme);

      await tray.getByRole("link", { name: "Go to checkout" }).click();
      await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Order summary" })).toContainText("EDG-Z10");
      await scanAccessibility(page, theme);
      await page.getByRole("button", { name: "Continue to payment" }).click();
      await expect(page.getByLabel("Business name")).toHaveAttribute("aria-invalid", "true");
      await scanAccessibility(page, theme);
    });

    test("catalogue error recovery and its initial document colour", async ({ page, context }) => {
      const db = await connectAccountDb();
      let fixture: Awaited<ReturnType<typeof createAccountCatalogue>> | undefined;
      try {
        fixture = await createAccountCatalogue(db);
        await db.query("update public.variants set specs = '{\"Fixture\": {\"invalid\": true}}' where id = $1", [fixture.available.id]);
        const route = "/blades/" + fixture.available.sku.replace(/-45$/, "").toLowerCase();
        await expectFallbackTheme(context, route, theme, 500);
        await scanRoutes(page, theme, [[route, "We couldn’t load the blades"]]);
      } finally {
        try {
          if (fixture) {
            await db.query("delete from public.stock_movements where variant_id in (select id from public.variants where product_id = $1)", [fixture.productId]);
            await db.query("delete from public.variants where product_id = $1", [fixture.productId]);
            await db.query("delete from public.products where id = $1", [fixture.productId]);
          }
        } finally {
          await db.end();
        }
      }
    });

    test("authenticated staff routes show the intended desk and detail screens", async ({ page, context }) => {
      test.setTimeout(60_000);
      await withNet30Data(async ({ db, buyer, warehouse: staff, application, sku, variantId }) => {
        const admin = localAdminClient();
        const order = await seedPaidAdminOrder({ sku, buyerId: buyer.id, email: buyer.email });
        const enquiry = randomUUID();
        const trial = randomUUID();
        try {
          const [roles, match, sample, variants] = await Promise.all([
            admin.from("staff_members").insert([
              { user_id: staff.id, role: "catalogue" },
              { user_id: staff.id, role: "finance" },
            ]),
            admin.rpc("submit_enquiry", {
              p_id: enquiry, p_kind: "compatibility", p_email: buyer.email,
              p_query: "Fixture blade", p_message: "Can you confirm the correct part?",
            }),
            admin.rpc("submit_trial_request", {
              p_id: trial, p_machine_brand: "Zünd", p_oem_code: "3910301",
              p_email: buyer.email, p_company: company, p_postcode: "SW1A 1AA",
            }),
            admin.from("variants").select("id,sku").in("sku", ["EDG-Z10", "EDG-Z11"]),
          ]);
          const error = roles.error ?? match.error ?? sample.error ?? variants.error;
          if (error) throw error;
          const ids = Object.fromEntries(variants.data!.map((variant) => [variant.sku, variant.id]));
          await signInStaff(page, staff);
          const missing = `/admin/warehouse/${randomUUID()}`;
          await expectFallbackTheme(context, missing, theme, 404);
          await scanRoutes(page, theme, [
            ["/admin", "Staff desk"],
            ["/admin/delivery", "Customer delivery settings"],
            ["/admin/commercial", "Shop performance"],
            ["/admin/warehouse", "New sales orders"],
            ["/admin/warehouse?view=history", "Past sales orders"],
            ["/admin/warehouse?view=blocked", "Payment blocks"],
            ["/admin/stock", "Adjust stock", "Purchasing"],
            ["/admin/stock?view=out-of-stock", "Out of stock", "Purchasing"],
            ["/admin/stock/receive", "Book in a delivery", "Purchasing"],
            ["/admin/stock/deliveries", "Delivery history", "Purchasing"],
            ["/admin/catalogue", "Stock", "Purchasing"],
            ["/admin/catalogue?q=EDG-Z10&status=published", "Stock", "Purchasing"],
            ["/admin/catalogue?view=running-low", "Stock", "Purchasing"],
            ["/admin/purchase-orders/settings", "Business details", "Admin"],
            ["/admin/finance", "Finance and trade accounts"],
            ["/admin/sales", "Sales reports"],
            ["/admin/requests", "Customer enquiries"],
          ], true);
          await scanRoutes(page, theme, [
            ["/admin/stock/receive?view=standalone", "Receive without a purchase order", "Purchasing"],
            ["/admin/catalogue/new", "Add draft variant", "Purchasing"],
            [`/admin/warehouse/${order.id}`, "Warehouse order", "Sales orders"],
            [missing, noPage],
            [`/admin/stock/${variantId}`, sku, "Purchasing"],
            [`/admin/catalogue/${ids["EDG-Z10"]}`, product, "Purchasing"],
            [`/admin/catalogue/${ids["EDG-Z11"]}`, /blade/i, "Purchasing"],
            [`/admin/requests/enquiries/${enquiry}`, "Compatibility enquiry", "Sales orders"],
            [`/admin/requests/trials/${trial}`, "Trial request", "Sales orders"],
            [`/admin/requests/trade/${application}`, company, "Sales orders"],
          ]);
          await page.goto(`/admin/requests/enquiries/${enquiry}`);
          await page.locator("summary").filter({ hasText: /^Close enquiry$/ }).click();
          await expect(page.getByRole("button", { name: "Confirm close enquiry" })).toBeVisible();
          await scanAccessibility(page, theme);

          await db.query("select public.review_trade_application($1,$2,'approved')", [application, staff.id]);
          const { rows: [account] } = await db.query<{ id: string }>(
            "select id from public.approve_trade_account($1,$2,200000,$3)",
            [application, staff.id, `cus_${randomUUID().replaceAll("-", "")}`],
          );
          await scanRoutes(page, theme, [[`/admin/finance/accounts/${account!.id}`, company, "Admin"]]);
          await page.locator("summary").filter({ hasText: /^Suspend Net 30$/ }).click();
          await expect(page.getByRole("button", { name: "Confirm suspend Net 30" })).toBeVisible();
          await scanAccessibility(page, theme);

          await page.setViewportSize({ width: 320, height: 800 });
          await page.goto(`/admin/catalogue/${ids["EDG-Z10"]}`);
          await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
          const materials = page.getByRole("group", { name: "Verified materials" });
          const technicalFabric = materials.getByRole("checkbox", { name: "Carbon and aramid fabric" });
          const label = materials.getByText("Carbon and aramid fabric", { exact: true });
          await expect(label).toBeVisible();
          expect(await materials.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
            await materials.evaluate((element) => element.clientWidth),
          );
          await technicalFabric.focus();
          await expect(technicalFabric).toBeFocused();
          await page.keyboard.press("Space");
          await expect(technicalFabric).toBeChecked();
          await scanAccessibility(page, theme);
          await page.goto(`/admin/warehouse/${order.id}/print`);
          await expect(page.getByRole("heading", { name: "Pick list" })).toBeVisible();
          await expect(page.locator(".admin-location")).toHaveText("Sales orders");
          await scanAccessibility(page, theme);
          await page.emulateMedia({ media: "print" });
          await expect(page.locator("html")).toHaveCSS("background-color", "rgb(255, 255, 255)");
          await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
          await expect(page.getByRole("banner")).toBeHidden();
          await expect(page.locator(".admin-location")).toBeHidden();
          const printEyebrow = page.locator(".warehouse-pick-list .eyebrow");
          await expect(printEyebrow).toHaveText("Warehouse");
          await expect(printEyebrow).toBeVisible();
          await expect(page.getByRole("heading", { name: "Pick list" })).toBeVisible();
          await page.emulateMedia({ media: "screen" });
          const cancellation = await admin.rpc("cancel_order", {
            p_actor_id: staff.id, p_order_id: order.id, p_operation_key: randomUUID(),
          });
          if (cancellation.error) throw cancellation.error;
          await page.goto("/admin/finance");
          const refundRow = page.getByRole("table", { name: "Outstanding captures" })
            .getByRole("row").filter({ hasText: order.reference });
          await refundRow.locator("summary").filter({ hasText: /^Verify or refund remaining capture$/ }).click();
          const confirmRefund = refundRow.getByRole("checkbox", { name: /remaining capture can be refunded/i });
          await expect(confirmRefund).toBeVisible();
          await expect(confirmRefund).toHaveAccessibleDescription(/this issues a refund for the full remaining capture/i);
          await expect(confirmRefund).toHaveCSS("width", "24px");
          await expect(confirmRefund).toHaveCSS("height", "24px");
          await scanAccessibility(page, theme);
        } finally {
          await db.query("delete from public.trial_requests where id = $1", [trial]);
          await db.query("delete from public.enquiries where id = $1", [enquiry]);
        }
      });
    });
  });
}
