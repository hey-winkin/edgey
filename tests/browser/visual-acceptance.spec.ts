import { expect, test, type Page } from "@playwright/test";
import { scanAccessibility, themes, saveThemeBeforeLoad } from "../helpers/accessibility";

async function verifyBoardContrast(page: Page, incomplete: Awaited<ReturnType<typeof scanAccessibility>>) {
  const measuredArtwork = new Map([
    ['text[x="580"]', "Print face annotation overlaps the dot plate"],
    ['text[x="388"]', "Back liner annotation overlaps the dot plate"],
    ['text[x="4"]', "Fluted core annotation overlaps the dot plate"],
    [".view-switch > button:nth-child(1)", "Ink uses the measured repeating hatch"],
    [".view-switch > button:nth-child(2)", "Outline uses the measured repeating hatch"],
  ]);
  const unmeasured = incomplete.filter(({ id, target }) =>
    id !== "color-contrast" || target.length !== 1 || typeof target[0] !== "string" || !measuredArtwork.has(target[0]),
  );
  expect(unmeasured, "Unreviewed axe results in the material-study state").toEqual([]);
  const measurements = await page.locator(".study").evaluate((study) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const luminance = (base: string, overlay?: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 1, 1);
      if (overlay) {
        ctx.fillStyle = overlay;
        ctx.fillRect(0, 0, 1, 1);
      }
      const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * rgb[0]! + .7152 * rgb[1]! + .0722 * rgb[2]!;
    };
    const contrast = (ink: number, background: number) => (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05);
    const plate = getComputedStyle(study);
    const plateBackground = [luminance(plate.backgroundColor), luminance(plate.backgroundColor, plate.getPropertyValue("--edgey-drawing-dots").trim())];
    const labels = Array.from(study.querySelectorAll(".annotation text")).map((label) => ({
      text: label.textContent,
      minimumContrast: Math.min(...plateBackground.map((bg) => contrast(luminance(getComputedStyle(label).fill), bg))),
    }));
    const active = getComputedStyle(study.querySelector('.view-switch [aria-pressed="true"]')!);
    const gradientColors = active.backgroundImage.match(/rgba?\([^)]+\)/g) ?? [];
    return [
      ...labels,
      {
        text: "Selected drawing view over hatch",
        minimumContrast: Math.min(...[undefined, ...gradientColors].map((stripe) =>
          contrast(luminance(active.color), luminance(active.backgroundColor, stripe)))),
      },
    ];
  });
  await test.info().attach("artwork-contrast-review", {
    contentType: "application/json",
    body: JSON.stringify({
      axeNeedsReview: incomplete.map(({ target, failureSummary }) => ({
        target, failureSummary, reason: measuredArtwork.get(String(target[0])),
      })),
      measuredAgainst: "Board plate and dot colours; the selected control's base and composited hatch colours. The proof wordmark is decorative.",
      measurements,
    }, null, 2),
  });
  for (const { text, minimumContrast } of measurements) {
    expect(minimumContrast, text ?? "Artwork text").toBeGreaterThanOrEqual(4.5);
  }
}

test("a saved light theme sets the browser colour before hydration", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("edgey-theme", "light"));
  let scriptsBlocked = 0;
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, (route) => {
    scriptsBlocked++;
    return route.abort();
  });

  for (const [url, status] of [["/", 200], ["/blades/missing-blade", 404], ["/missing-edgey-page", 404]] as const) {
    await test.step(url, async () => {
      expect((await page.goto(url))?.status()).toBe(status);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(250, 250, 248)");
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#FAFAF8");
    });
  }
  expect(scriptsBlocked).toBeGreaterThan(0);
});

for (const theme of themes) {
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 640]] as const) {
    test(`${theme} at ${width}px supports doubled text and reduced motion`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await saveThemeBeforeLoad(page, theme);
      for (const route of ["/", "/blades", "/blades?q=3910301"]) {
        await test.step(route, async () => {
          await page.goto(route);
          await expect(page.locator("body")).toHaveCSS("font-size", "16px");
          const caption = page.locator(".study figcaption");
          if (route === "/" && width === 320) {
            await expect(caption).toBeVisible();
            const [label, view] = await caption.locator(":scope > *").evaluateAll((elements) =>
              elements.map((element) => element.getBoundingClientRect().toJSON()));
            expect(label.right).toBeLessThan(view.left);
            expect(label.top).toBeLessThan(view.bottom);
            expect(label.bottom).toBeGreaterThan(view.top);
          }
          await page.locator("html").evaluate((html) => { html.style.fontSize = "200%"; });
          await expect(page.locator("body")).toHaveCSS("font-size", "32px");
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          await expect(page.locator(".p-card-image img").first()).toHaveCSS("transition-duration", "0s");
          expect(await page.locator(".select-field select").evaluateAll((selects) => {
            const canvas = document.createElement("canvas").getContext("2d")!;
            return selects.flatMap((element) => {
              const select = element as HTMLSelectElement;
              const css = getComputedStyle(select);
              canvas.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
              const available = select.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
              return Array.from(select.options).filter((option) => canvas.measureText(option.text).width > available)
                .map((option) => option.text);
            });
          })).toEqual([]);
          if (route === "/") {
            await expect(page.locator(".mat-copy > p").last()).toHaveCSS("font-size", "32px");
            await page.keyboard.press("Tab");
            const skip = page.getByRole("link", { name: "Skip to catalogue" });
            await expect(skip).toBeFocused();
            await skip.press("Enter");
            await expect(page.locator("#catalogue")).toBeFocused();
            await page.keyboard.press("/");
            await expect(page.getByRole("searchbox")).toBeFocused();
            expect(await page.locator(".proof-option span").evaluateAll((labels) => labels
              .filter((label) => label.scrollWidth > label.clientWidth)
              .map((label) => label.textContent))).toEqual([]);
            const proof = page.getByRole("button", { name: "Violet" });
            await proof.press("Space");
            await expect(proof).toHaveAttribute("aria-pressed", "true");
            const outline = page.getByRole("button", { name: "Outline" });
            await outline.press("Enter");
            await expect(outline).toHaveAttribute("aria-pressed", "true");
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
            if (width === 320) {
              const [label, view] = await caption.locator(":scope > *").evaluateAll((elements) =>
                elements.map((element) => element.getBoundingClientRect().toJSON()));
              expect(view.top).toBeGreaterThan(label.bottom);
              expect(view.right).toBeLessThanOrEqual(width);
            }
            const incomplete = await scanAccessibility(page, theme);
            if (width === 1440) await verifyBoardContrast(page, incomplete);
          }
        });
      }

      await page.goto("/blades/edg-z10");
      await page.locator("html").evaluate((html) => { html.style.fontSize = "200%"; });
      const priceBreaks = page.getByRole("region", { name: "Price breaks per blade for EDG-Z10" });
      const references = page.getByRole("region", { name: "Verified references for EDG-Z10" });
      await expect(priceBreaks).toHaveAttribute("tabindex", "0");
      await expect(references).toHaveAttribute("tabindex", "0");
      if (width === 320) {
        const add = page.getByRole("button", { name: "Add to selection" });
        await expect(add).toBeEnabled();
        await add.focus();
        await page.keyboard.press("Tab");
        await expect(priceBreaks).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(references).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => references.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await scanAccessibility(page, theme);

      await page.goto("/blades");
      await page.getByRole("link", { name: /EDG-Z10 Flat-stock drag blade/ }).click();
      const dialog = page.getByRole("dialog", { name: "Flat-stock drag blade" });
      const artwork = dialog.locator(".figure-plate");
      await expect(artwork.getByAltText("Line drawing for EDG-Z10")).toHaveAttribute("src", "/line-art/drag-line.svg");
      const plate = await artwork.boundingBox();
      expect(plate?.height).toBeGreaterThanOrEqual(120);
      expect(plate?.height).toBeLessThanOrEqual(175);
      for (const pack of ["1", "5", "10"]) {
        const box = await dialog.getByRole("button", { name: pack, exact: true }).boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(48);
        expect(box?.height).toBeGreaterThanOrEqual(37);
      }
      if (width === 320) {
        await test.step("Compact product and selection dialogs and checkout at 200%", async () => {
          await page.locator("html").evaluate((html) => { html.style.fontSize = "200%"; });
          const add = dialog.getByRole("button", { name: "Add to selection" });
          await expect(add).toBeEnabled();
          expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
          await scanAccessibility(page, theme);
          await add.click();
          const selection = page.getByRole("dialog", { name: "Your selection" });
          await expect(selection.getByRole("button", { name: "Remove EDG-Z10" })).toBeVisible();
          expect(await selection.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
          await scanAccessibility(page, theme);
          await selection.getByRole("link", { name: "Go to checkout" }).click();
          await expect(page.getByRole("region", { name: "Order summary" })).toContainText("EDG-Z10");
          await expect(page.locator("body")).toHaveCSS("font-size", "32px");
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          await scanAccessibility(page, theme);
        });
      }
    });
  }
}

test("proof names and the populated masthead fit at 320px with enlarged text", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => {
    localStorage.setItem("edgey-storefront-selection-v1", '{"42e5ce02-4d5e-5c39-9f1b-f76c46c8b386":200}');
  });
  await page.goto("/");
  const selection = page.getByRole("button", { name: "Selection 200 blades" });
  await expect(selection).toBeVisible();
  const names = page.locator(".proof-option span");
  await expect(names).toHaveText(["Prism", "Coral", "Glacier", "Citron", "Violet"]);
  expect(await names.evaluateAll((labels) => new Set(labels.map((label) => label.getBoundingClientRect().top)).size)).toBe(1);

  await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
  expect(await names.evaluateAll((labels) => labels.filter((label) => {
    const text = document.createRange();
    text.selectNodeContents(label);
    return text.getBoundingClientRect().right > label.closest("button")!.getBoundingClientRect().right;
  }).map((label) => label.textContent))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(selection).toBeInViewport({ ratio: 1 });
});
