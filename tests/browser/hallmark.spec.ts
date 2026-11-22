import { expect, test } from "@playwright/test";
import { saveThemeBeforeLoad, themes } from "../helpers/accessibility";
import { contrast, expectControlBoundary } from "../helpers/contrast";

for (const theme of themes) {
  test(`Finder, request and staff boundaries and footer focus contrast in ${theme}`, async ({ page }) => {
    await saveThemeBeforeLoad(page, theme);
    for (const route of ["/", "/blades", "/blades?machine=zund&material=corrugated-board"]) {
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectControlBoundary(page.locator(".search-field, .select-field"));
    }

    const footer = page.getByRole("contentinfo");
    const proof = footer.getByRole("link", { name: "Edgey back to top" });
    const contact = footer.getByRole("link", { name: "Contact" });
    await contact.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(proof).toBeFocused();
    const focus = await proof.evaluate(el => {
      const { boxShadow, outlineColor, outlineOffset, outlineStyle, outlineWidth } = getComputedStyle(el);
      return { boxShadow, outlineColor, outlineOffset, outlineStyle, outlineWidth };
    });
    expect(focus.outlineStyle).toBe("solid");
    expect(parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);
    const shadow = /^(rgb\([^)]+\)) 0px 0px 0px ([\d.]+)px$/.exec(focus.boxShadow);
    if (!shadow?.[1]) throw new Error("Expected a solid second focus ring: " + focus.boxShadow);
    const spread = Number(shadow[2]);
    expect(spread).toBeGreaterThanOrEqual(2);
    expect(parseFloat(focus.outlineOffset)).toBe(spread);
    expect(contrast(focus.outlineColor, shadow[1])).toBeGreaterThanOrEqual(9);
    await page.keyboard.press("Tab");
    await expect(contact).toBeFocused();
    await expect(contact).toHaveCSS("outline-color", theme === "light" ? "rgb(33, 93, 173)" : "rgb(155, 227, 249)");

    await page.goto("/enquiry");
    await expectControlBoundary(page.locator("main form :is(input:not([type=hidden], [tabindex='-1']), textarea, .select-field)"));
    await page.goto("/trade");
    await expectControlBoundary(page.getByRole("textbox", { name: "Work email" }));
    await page.goto("/admin/sign-in");
    await expectControlBoundary(page.locator("main form input:not([type=hidden])"));
  });

  test(`short desktop shows both cutting study links in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await saveThemeBeforeLoad(page, theme);
    await page.goto("/");
    const study = page.getByRole("region", { name: "Corrugated board", exact: true });
    await expect(study.getByRole("link", { name: "View blade details" })).toBeInViewport({ ratio: 1 });
    await expect(study.getByRole("link", { name: /See \d+ blades? for Corrugated board/ })).toBeInViewport({ ratio: 1 });
    await expect(study.getByText("Owner-supplied specifications (unverified).")).toBeInViewport({ ratio: 1 });
    expect((await page.locator(".search-field").first().boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });
}

test("the compatibility enquiry heading doesn't orphan its last word on a 375px phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/enquiry");
  const heading = page.getByRole("heading", { name: "Ask us to match this blade" });
  const wordTops = await heading.evaluate(async (element) => {
    await document.fonts.ready;
    const range = document.createRange();
    const text = element.firstChild!;
    return [...text.textContent!.matchAll(/\S+/g)].map(({ 0: word, index }) => {
      range.setStart(text, index);
      range.setEnd(text, index + word.length);
      return range.getBoundingClientRect().top;
    });
  });
  expect(new Set(wordTops).size).toBe(2);
  expect(wordTops.at(-1)).toBe(wordTops.at(-2));
});
