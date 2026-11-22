import { switchTheme } from "../helpers/navigation";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";
import { requestTrapField } from "../../src/lib/requests/forms";
import { scanBothThemes } from "../helpers/accessibility";
import { expectControlBoundary } from "../helpers/contrast";

test.use({ trace: "off" });

const inbox = "http://127.0.0.1:54324";
const emailFor = (form: string) => `${form}-${randomUUID()}@example.com`;

async function focusFormByKeyboard(page: Page, firstField: Locator) {
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstField).toBeFocused();
  await expect(firstField).toHaveCSS("outline-style", "solid");
}

async function openSignInLink(page: Page, email: string) {
  let link: URL | undefined;
  await expect.poll(async () => {
    const search = new URL("/api/v1/search", inbox);
    search.searchParams.set("query", "to:" + email);
    const response = await fetch(search);
    const { messages } = await response.json() as { messages: { ID: string }[] };
    const first = messages[0];
    if (!first) return false;
    const message = await fetch(new URL("/api/v1/message/" + first.ID, inbox));
    const { HTML } = await message.json() as { HTML: string };
    for (const [, href] of HTML.matchAll(/href="([^"]+)"/g)) {
      if (!href) continue;
      const candidate = URL.parse(href.replaceAll("&amp;", "&"));
      if (!candidate) continue;
      if (candidate.origin === "http://127.0.0.1:54321" && candidate.pathname === "/auth/v1/verify") {
        link = candidate;
        return true;
      }
    }
    return false;
  }, { message: "The local inbox receives a Supabase sign-in link" }).toBe(true);
  await page.goto(link!.href, { waitUntil: "domcontentloaded" });
  return link!;
}

test("carries an unmatched code into a keyboard-accessible compatibility enquiry", async ({ page }) => {
  await page.goto("/blades?q=TEST-4047");
  await page.getByRole("link", { name: "Ask us to match this blade" }).click();
  const search = page.getByRole("textbox", { name: "Your search" });
  await expect(search).toHaveValue("TEST-4047");
  await search.fill("TEST-4048");

  const send = page.getByRole("button", { name: "Send enquiry" });
  await send.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Check the form" })).toBeFocused();
  const reply = page.getByRole("textbox", { name: "Reply email" });
  await expect(reply).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("link", { name: "Enter a valid email address." }).press("Enter");
  await expect(reply).toBeFocused();
  await expect(search).toHaveValue("TEST-4048");
  await reply.fill(emailFor("compatibility"));
  const machine = page.getByRole("combobox", { name: "Machine brand" });
  await expect(machine.getByRole("option", { name: "iEcho" })).toHaveCount(1);
  await machine.selectOption({ label: "JWEI" });
  await page.getByRole("textbox", { name: "Message" }).fill("Does this reference fit the original holder?");
  await send.press("Enter");
  await expect(page.getByRole("heading", { name: "Enquiry received" })).toBeFocused();
  await expect(page.getByRole("status")).toContainText("reply by email");
  await scanBothThemes(page);
});

test("carries an unsupported delivery postcode and validates its enquiry", async ({ page }) => {
  await page.goto("/enquiry?postcode=HS1%202AA");
  const postcode = page.getByRole("textbox", { name: "Delivery postcode" });
  await focusFormByKeyboard(page, postcode);
  await expect(postcode).toHaveValue("HS1 2AA");
  await postcode.fill("HS1");
  await page.getByRole("textbox", { name: "Reply email" }).fill(emailFor("delivery"));
  await page.getByRole("textbox", { name: "Message" }).fill("Can you quote delivery to Stornoway?");
  const send = page.getByRole("button", { name: "Send enquiry" });
  await send.press("Enter");
  await expect(postcode).toHaveAccessibleDescription(/Enter a full UK postcode/);
  await postcode.fill("hs1 2aa");
  await send.press("Enter");
  await expect(page.getByRole("heading", { name: "Enquiry received" })).toBeFocused();
});

test("requests a trial with exactly five fields and no delivery promise", async ({ page }) => {
  await page.goto("/sample-pack");
  const form = page.getByRole("main").locator("form");
  const brand = form.getByRole("combobox", { name: "Machine brand" });
  await focusFormByKeyboard(page, brand);
  await expect(form.getByRole("textbox")).toHaveCount(4);
  await expect(form.getByRole("combobox")).toHaveCount(1);
  const submit = form.getByRole("button", { name: "Request trial blades" });
  await submit.press("Enter");
  await expect(brand).toHaveAccessibleDescription("Choose a machine brand.");
  await expect(form.getByRole("textbox", { name: "OEM code" })).toHaveAccessibleDescription(/type “unknown”/);
  await scanBothThemes(page);
  await brand.selectOption({ label: "iEcho" });
  await form.getByRole("textbox", { name: "OEM code" }).fill("unknown");
  await form.getByRole("textbox", { name: "Work email" }).fill(emailFor("trial"));
  await form.getByRole("textbox", { name: "Company" }).fill("Proof Room");
  await form.getByRole("textbox", { name: "Postcode" }).fill("SW1A1AA");
  await submit.press("Enter");
  await expect(page.getByRole("heading", { name: "Trial request received" })).toBeFocused();
  await expect(page.getByRole("status")).toContainText("No delivery has been arranged");
  await scanBothThemes(page);
});

test("records exact, suggested and unmatched searches without retaining private text", async ({ page }) => {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("Run pnpm db:env before running browser tests.");
  const db = new Client({ connectionString });
  await db.connect();
  try {
    const { rows } = await db.query<{ since: Date }>("select clock_timestamp() as since");
    const since = rows[0]?.since;
    if (!since) throw new Error("Could not read the local database clock.");
    const privateEmail = emailFor("search");
    for (const query of ["3910-301", "vinyl", "EDG-NOT-8927345", privateEmail]) {
      await page.goto("/blades?q=" + encodeURIComponent(query));
    }
    await expect.poll(async () => {
      const { rows } = await db.query(
        "select outcome, normalised_query, query_fingerprint from public.finder_search_events where created_at >= $1",
        [since],
      );
      expect(JSON.stringify(rows)).not.toContain(privateEmail);
      return rows;
    }).toEqual(expect.arrayContaining([
      { outcome: "exact", normalised_query: "3910301", query_fingerprint: null },
      { outcome: "suggested", normalised_query: "vinyl", query_fingerprint: null },
      { outcome: "unmatched", normalised_query: null, query_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { outcome: "unmatched", normalised_query: null, query_fingerprint: null },
    ]));
  } finally {
    await db.end();
  }
});

test("requires email verification and remembers an application as pending", async ({ page, browser }) => {
    const email = emailFor("trade");
    await page.goto("/trade");
    const address = page.getByRole("textbox", { name: "Work email" });
    await focusFormByKeyboard(page, address);
    await expect(page.getByRole("textbox", { name: "Buyer name" })).toHaveCount(0);
    const send = page.getByRole("button", { name: "Send sign-in link" });
    await send.press("Enter");
    await expect(address).toHaveAccessibleDescription("Enter a valid email address.");
    await address.fill(email);
    await send.press("Enter");
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
    await scanBothThemes(page);
    const link = await openSignInLink(page, email);

    await expect(page).toHaveURL(/\/trade$/);
    await expect(page.getByText(/one named buyer/)).toBeVisible();
    const isolatedContext = await browser.newContext();
    try {
      const replay = await isolatedContext.newPage();
      await replay.goto(link.href);
      await expect(replay.getByRole("heading", { name: "We couldn’t verify the sign-in link" })).toBeVisible();
      await expect(replay.getByRole("textbox", { name: "Buyer name" })).toHaveCount(0);
      await scanBothThemes(replay);
    } finally {
      await isolatedContext.close();
    }
    const buyer = page.getByRole("textbox", { name: "Buyer name" });
    const applicationFields = page.locator("main form input:not([type=hidden], [tabindex='-1'])");
    await expectControlBoundary(applicationFields);
    await switchTheme(page, "light");
    await expectControlBoundary(applicationFields);
    await switchTheme(page, "dark");
    const submit = page.getByRole("button", { name: "Submit application" });
    await submit.press("Enter");
    await expect(page.getByRole("heading", { name: "Check the form" })).toBeFocused();
    await expect(buyer).toHaveAccessibleDescription("Enter the buyer’s full name.");
    await scanBothThemes(page);
    await buyer.fill("Test Buyer");
    await page.getByRole("textbox", { name: "Company" }).fill("Proof Room");
    await page.getByRole("textbox", { name: "Billing address line 1" }).fill("1 Print Lane");
    await page.getByRole("textbox", { name: "Town or city" }).fill("London");
    await page.getByRole("textbox", { name: "Billing postcode" }).fill("SW1A 1AA");
    await submit.press("Enter");
    await expect(page.getByRole("heading", { name: "Application received" })).toBeFocused();
    await expect(page.getByRole("status")).toContainText("pending");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Application pending" })).toBeVisible();
    await scanBothThemes(page);
    await page.getByRole("button", { name: "Sign out" }).press("Enter");
    await expect(page.getByRole("textbox", { name: "Work email" })).toBeVisible();
});

test("reports a blocked honeypot submission and an email rate limit without a false receipt", async ({ page }) => {
  const email = emailFor("rate-limit");
  for (let index = 0; index < 5; index++) {
    await page.goto("/sample-pack");
    await page.getByRole("combobox", { name: "Machine brand" }).selectOption("jwei");
    await page.getByRole("textbox", { name: "OEM code" }).fill("unknown");
    await page.getByRole("textbox", { name: "Work email" }).fill(email);
    await page.getByRole("textbox", { name: "Company" }).fill("Proof Room");
    await page.getByRole("textbox", { name: "Postcode" }).fill("SW1A 1AA");
    const submit = page.getByRole("button", { name: "Request trial blades" });
    if (index === 0) await page.locator(`input[name="${requestTrapField}"]`).evaluate((input: HTMLInputElement) => { input.value = "filled"; });
    await submit.press("Enter");
    if (index === 0) {
      await expect(page.getByText(/Reload the page and try again/)).toBeVisible();
    } else if (index === 4) {
      await expect(page.getByText(/Too many requests/)).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Trial request received" })).toBeVisible();
    }
  }
});

for (const width of [320, 390, 1440]) {
  test(`request pages fit in light and dark at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/enquiry?q=NOT-FOUND");
    for (const theme of ["dark", "light"]) {
      if (theme === "light") await switchTheme(page, "light");
      for (const route of ["/enquiry?q=NOT-FOUND", "/enquiry?postcode=HS1%202AA", "/sample-pack", "/trade"]) {
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        if (width === 320) {
          await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          const menu = page.locator('summary[aria-label="Edgey shop menu"]');
          await menu.click();
          await expect(page.getByRole("navigation", { name: "Shop navigation" }).getByRole("link", { name: "Trade accounts" })).toBeVisible();
          await menu.click();
        }
      }
    }
  });
}
