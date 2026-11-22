import { expect, test } from "@playwright/test";

test("unscoped checkout returns are private, inert and contain no order information", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("edgey-storefront-selection-v1", '{"42e5ce02-4d5e-5c39-9f1b-f76c46c8b386":2}');
  });
  for (const query of [
    "",
    "?session_id=not-a-checkout-session",
    "?session_id=cs_test_example1&session_id=cs_test_example2",
    "?session_id=cs_live_example1",
    "?session_id=cs_test_example1%0A",
    `?session_id=cs_test_${"x".repeat(191)}`,
  ]) {
    const response = await page.goto(`/checkout/success${query}`);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.getByRole("main").getByRole("status")).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("heading", { name: "Checkout not found" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order summary" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check payment status" })).toHaveCount(0);
    await expect(page.getByText("Order reference", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Continue browsing" })).toHaveAttribute("href", "/blades");
    await expect(page.getByRole("button", { name: "Basket 2 blades" })).toBeEnabled();
  }
});
