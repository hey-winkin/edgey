import { expect, test } from "@playwright/test";

test("the drawing follows the exact plotter option on the card and product page", async ({ page }) => {
  await page.goto("/blades?q=EDG-MIM-A60");
  const card = page.getByRole("link", { name: /EDG-MIM-45 Mimaki-pattern plotter blade/ });
  await expect(page.locator(".p-card").filter({ has: card }).locator("img"))
    .toHaveAttribute("src", "/line-art/edg-mim-a60-line.svg");
  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByAltText("Line drawing for EDG-MIM-A60")).toHaveAttribute("src", "/line-art/edg-mim-a60-line.svg");
  await dialog.getByRole("button", { name: "45°", exact: true }).click();
  await expect(dialog.getByAltText("Line drawing for EDG-MIM-A45")).toHaveAttribute("src", "/line-art/edg-mim-a45-line.svg");
  await page.goto("/blades/edg-mim-45?variant=EDG-MIM-A60");
  const drawing = page.locator(".figure-plate img");
  await expect(drawing).toHaveAttribute("src", "/line-art/edg-mim-a60-line.svg");
  await page.getByRole("button", { name: "45°", exact: true }).click();
  await expect(drawing).toHaveAttribute("src", "/line-art/edg-mim-a45-line.svg");
  expect(await drawing.evaluate((image: HTMLImageElement) => image.decode().then(() => image.naturalWidth))).toBeGreaterThan(0);
});
