import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { switchTheme } from "./navigation";

export const themes = ["dark", "light"] as const;
export type Theme = (typeof themes)[number];

export async function saveThemeBeforeLoad(page: Page, theme: Theme) {
  await page.addInitScript((value) => localStorage.setItem("edgey-theme", value), theme);
}

export async function scanAccessibility(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  const { violations, incomplete } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(violations.map(({ id, nodes }) => ({
    id,
    nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  })), `axe violations in ${theme}: ${new URL(page.url()).pathname}`).toEqual([]);
  const needsReview = incomplete.flatMap(({ id, nodes }) =>
    nodes.map(({ target, failureSummary }) => ({ id, target, failureSummary })),
  );
  if (needsReview.length) {
    const info = test.info();
    const route = new URL(page.url()).pathname;
    const path = info.outputPath(`axe-manual-review-${theme}-${info.attachments.length}.json`);
    await writeFile(path, JSON.stringify({ theme, route, results: needsReview }, null, 2));
    await info.attach(`axe manual review: ${theme} ${route}`, {
      contentType: "application/json",
      path,
    });
  }
  return needsReview;
}

export async function scanBothThemes(page: Page) {
  const html = page.locator("html");
  const initial = (await html.getAttribute("data-theme")) === "light" ? "light" : "dark";
  await scanAccessibility(page, initial);
  const other = initial === "dark" ? "light" : "dark";
  await switchTheme(page, other);
  await scanAccessibility(page, other);
  await switchTheme(page, initial);
  await expect(html).toHaveAttribute("data-theme", initial);
}
