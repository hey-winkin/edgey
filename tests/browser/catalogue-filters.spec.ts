import { expect, test } from "@playwright/test";

test("published tool heads follow the machine without taking other brands’ fits", async ({ page }) => {
  await page.goto("/blades?machine=zund&head=uct&depth=5");
  const head = page.getByRole("combobox", { name: "Tool head" });
  await expect(head).toHaveValue("uct");
  await expect(head.getByRole("option", { name: "POT", exact: true })).toHaveCount(1);
  await expect(head.getByRole("option", { name: "HF VibraCut", exact: true })).toHaveCount(0);
  await expect(page.locator(".cards .p-card")).toHaveCount(1);
  await expect(page.getByRole("link", { name: /EDG-Z16/ })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");

  const machine = page.getByRole("combobox", { name: "Machine" });
  await machine.focus();
  await machine.selectOption("kongsberg");
  await expect(page).toHaveURL((url) => url.searchParams.get("machine") === "kongsberg" && !url.searchParams.has("head"));
  await expect(machine).toBeFocused();
  await expect(head).toHaveValue("");
  await expect(head.getByRole("option", { name: "HF VibraCut", exact: true })).toHaveCount(1);
  await expect(head.getByRole("option", { name: "UCT", exact: true })).toHaveCount(0);
  await head.selectOption("hf vibracut");
  await expect(page).toHaveURL((url) => url.searchParams.get("head") === "hf vibracut" && url.searchParams.get("depth") === "5");

  await machine.selectOption("");
  await expect(page).toHaveURL((url) => url.searchParams.get("head") === "hf vibracut" && !url.searchParams.has("machine"));
  await expect(head).toHaveValue("hf vibracut");

  await page.goto("/blades?machine=summa&head=pot");
  await expect(page.getByRole("heading", { name: "No matching blades" })).toBeVisible();
  await expect(head.getByRole("option", { name: "POT", exact: true })).toHaveCount(0);

  await page.goto("/blades?head=uct");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
});

test("the empty state reports otherwise matching options without a recorded depth", async ({ page }) => {
  await page.goto("/blades?machine=mimaki&depth=1");
  await expect(page.getByRole("heading", { name: "No matching blades" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("0 blades shown. 2 otherwise matching blade options left out because no cutting depth is recorded.");
  await expect(page.getByRole("link", { name: "Match my blade" })).toHaveAttribute("href", "/enquiry");

  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/blades#catalogue$/);
  await expect(page.getByRole("spinbutton", { name: "Minimum depth (mm)" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Machine" })).toHaveValue("");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.getByRole("link", { name: /EDG-MIM-45/ })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/blades$/);
});

test("live depth changes combine with facets and reject invalid values without changing results", async ({ page }) => {
  await page.goto("/blades?q=3910301&type=drag&machine=zund&material=foamex&head=uct&depth=4.8");
  const depth = page.getByRole("spinbutton", { name: "Minimum depth (mm)" });
  const result = page.getByRole("link", { name: /EDG-Z10/ });
  await expect(result).toBeVisible();
  await depth.fill("4.81");
  await expect(page).toHaveURL((url) => url.searchParams.get("depth") === "4.81");
  await expect(result).toHaveCount(0);

  await depth.evaluate((input: HTMLInputElement) => {
    input.value = "4.8";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.value = "-1";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  const message = "Enter a number of 0 mm or more, or leave it blank.";
  await expect(depth).toHaveAttribute("aria-invalid", "true");
  await expect(depth).toHaveAccessibleDescription(message);
  await expect(page.getByRole("alert").filter({ hasText: message })).toBeVisible();
  await depth.press("ControlOrMeta+a");
  await depth.press("Minus");
  await expect(depth).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL((url) => url.searchParams.get("depth") === "4.81");
  await expect(result).toHaveCount(0);

  await depth.fill("4.8");
  await expect(depth).not.toHaveAttribute("aria-invalid");
  await expect(result).toBeVisible();
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
    q: "3910301", type: "drag", machine: "zund", material: "foamex", head: "uct", depth: "4.8",
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("switching machine explains an incompatible tool head and offers only valid replacements", async ({ page }) => {
    await page.goto("/blades?machine=zund&head=pot");
    const apply = page.getByRole("button", { name: "Apply filters" });
    const head = page.getByRole("combobox", { name: "Tool head", exact: true });
    await expect(head).toHaveValue("pot");
    await page.getByRole("combobox", { name: "Machine" }).selectOption("summa");
    await apply.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("machine") === "summa" && url.searchParams.get("head") === "pot");
    await expect(page.getByRole("heading", { name: "No matching blades" })).toBeVisible();
    const message = "That tool head isn’t listed for the selected machine. Choose a listed tool head or clear the filters.";
    await expect(page.getByText(message)).toBeVisible();
    await expect(head).toHaveAccessibleDescription(message);
    await expect(head).toHaveValue("");
    await expect(head.getByRole("option", { name: "POT", exact: true })).toHaveCount(0);
    await head.selectOption("d-series drag");
    await apply.click();
    await expect(page.getByText(message)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /EDG-SUM-DRG/ })).toBeVisible();
  });

  test("a GET submission combines search and all facets and keeps them on reload", async ({ page }) => {
    await page.goto("/blades");
    const apply = page.getByRole("button", { name: "Apply filters" });
    const head = page.getByRole("combobox", { name: "Tool head", exact: true });
    await expect(head.getByRole("option", { name: "HF VibraCut", exact: true })).toHaveCount(1);
    await page.getByRole("combobox", { name: "Machine" }).selectOption("zund");
    await apply.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("machine") === "zund");
    await expect(head.getByRole("option", { name: "HF VibraCut", exact: true })).toHaveCount(0);

    await page.getByRole("searchbox").fill("3910301");
    await page.getByRole("combobox", { name: "Tool type" }).selectOption("drag");
    await page.getByRole("combobox", { name: "Material" }).selectOption("foamex");
    await head.selectOption("uct");
    const depth = page.getByRole("spinbutton", { name: "Minimum depth (mm)" });
    await depth.fill("4.8");
    await apply.click();
    await expect(page).toHaveURL(/#catalogue$/);
    await expect(page.getByRole("region", { name: "Blade catalogue" })).toBeFocused();
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
      q: "3910301", type: "drag", machine: "zund", material: "foamex", head: "uct", depth: "4.8",
    });
    const active = page.locator(".filter-status");
    await expect(active).toContainText("1 blade · Search: “3910301” · Tool type: Drag · Machine: Zünd · Material: Foamex · Tool head: UCT · Cutting depth: at least 4.8 mm");
    await expect(page.getByRole("link", { name: /EDG-Z10/ })).toBeVisible();

    await page.reload();
    await expect(depth).toHaveValue("4.8");
    await expect(head).toHaveValue("uct");
    await depth.fill("4.81");
    await apply.click();
    await expect(page.getByRole("status")).toHaveText("0 blades shown.");
    await expect(page.getByRole("link", { name: "Ask us to match this blade" })).toHaveAttribute("href", "/enquiry?q=3910301");
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/blades#catalogue$/);
    await expect(page.getByRole("searchbox")).toHaveValue("");
  });
});
