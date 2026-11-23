import { expect, test, type Page } from "@playwright/test";

const variantPath = "/blades/edg-sum-drg?variant=EDG-SUM-DRG-60";

async function structuredData(page: Page) {
  return page.locator('script[type="application/ld+json"]').evaluateAll((scripts) =>
    scripts.map((script) => JSON.parse(script.textContent ?? "")));
}

test("HTML-only unfurlers get catalogue metadata and fetch the exact share-card PNG", async ({ request, baseURL }) => {
  const images: Buffer[] = [];
  for (const [path, agent, title, imageQuery] of [
    ["/", "Slackbot-LinkExpanding 1.0", "Edgey — The cutting room", ""],
    ["/blades", "Twitterbot/1.0", "Blade catalogue", ""],
    ["/brands/mimaki", "facebookexternalhit/1.1", "Mimaki blade references", ""],
    ["/reference-guide", "Applebot/0.1", "Blade cross-reference guide", ""],
    [variantPath, "WhatsApp/2.24", "EDG-SUM-DRG-60 Summa-pattern drag plotter blade", "?blade=edg-sum-drg&variant=EDG-SUM-DRG-60"],
  ] as const) {
    const res = await request.get(path, { headers: { "User-Agent": agent } });
    expect(res.ok()).toBe(true);
    const head = (await res.text()).split("</head>")[0] ?? "";
    expect(head).toContain(`<meta property="og:title" content="${title}"`);
    expect(head).toContain(`<meta name="twitter:title" content="${title}"`);
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(head).toContain('<meta name="robots" content="noindex, nofollow"');
    const image = head.match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    expect(image).toBe(`${baseURL}/share-image${imageQuery}`);
    expect(head).toContain(`<meta name="twitter:image" content="${image?.replaceAll("&", "&amp;")}"`);

    const card = await request.get(image!);
    expect(card.ok()).toBe(true);
    expect(card.headers()["content-type"]).toContain("image/png");
    const png = await card.body();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    images.push(png);
    if (path === variantPath) {
      expect(head).toContain('property="og:description" content="Drag blade for roll plotters cutting vinyl, thick laminate and reflective film."');
      expect(card.headers()["cache-control"]).toBe("no-store");
    }
  }
  expect(images.at(-1)).not.toEqual(images[0]);
  for (const query of ["blade=edg-z46&variant=EDG-Z46", "blade=edg-z10&variant=EDG-Z46", "blade=missing&variant=EDG-MISSING"]) {
    expect((await request.get("/share-image?" + query)).status()).toBe(404);
  }
});

test("breadcrumb JSON-LD matches the links and current page shown to buyers", async ({ page }) => {
  for (const [path, labels, hrefs] of [
    ["/blades", ["Home", "Blade catalogue"], ["/", "/blades"]],
    ["/brands/mimaki", ["Blade catalogue", "Mimaki"], ["/blades", "/brands/mimaki"]],
    ["/blades/edg-z10", ["Blade catalogue", "Drag", "EDG-Z10"], ["/blades", "/blades?type=drag", "/blades/edg-z10"]],
  ] as const) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });
    const links = nav.getByRole("link");
    await expect(nav.locator('[aria-current="page"]')).toHaveText(labels.at(-1)!);
    await expect(links).toHaveText([...labels.slice(0, -1)]);
    for (const [index, href] of hrefs.slice(0, -1).entries()) await expect(links.nth(index)).toHaveAttribute("href", href);

    const data = await structuredData(page);
    expect(data.map((entry) => entry["@type"])).toEqual(path.endsWith("edg-z10") ? ["BreadcrumbList", "Product"] : ["BreadcrumbList"]);
    expect(data[0].itemListElement).toEqual(labels.map((name, index) => ({
      "@type": "ListItem", name, position: index + 1, item: new URL(hrefs[index]!, page.url()).href,
    })));
  }
});

test("product JSON-LD uses the chosen SKU's public availability and per-blade tiers", async ({ page }) => {
  await page.goto("/blades/edg-sum-drg");
  const group = (await structuredData(page))[1];
  expect(group["@type"]).toBe("ProductGroup");
  expect(group.hasVariant.map(({ sku }: { sku: string }) => sku)).toEqual(["EDG-SUM-DRG-36", "EDG-SUM-DRG-60"]);
  expect(group.hasVariant.every((item: object) => !("offers" in item))).toBe(true);

  await page.goto(variantPath);
  const product = (await structuredData(page))[1];
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(product.name);
  expect(product).toMatchObject({ "@type": "Product", sku: "EDG-SUM-DRG-60", offers: { availability: "https://schema.org/OutOfStock" } });
  await expect(page.getByText("Out of stock", { exact: true }).first()).toBeVisible();
  const table = page.getByRole("table", { name: "Price breaks per blade for " + product.sku });
  const specs = product.offers.priceSpecification;
  expect(specs).toHaveLength(6);
  for (const [index, [min, max]] of [[1, 4], [5, 9], [10, undefined]].entries()) {
    const row = table.getByRole("row").nth(index + 1);
    for (const [column, vat] of [false, true].entries()) {
      const tier = specs[index * 2 + column];
      expect(tier).toMatchObject({
        "@type": "UnitPriceSpecification",
        priceCurrency: "GBP",
        valueAddedTaxIncluded: vat,
        eligibleQuantity: { minValue: min },
      });
      expect(tier.eligibleQuantity.maxValue).toBe(max);
      await expect(row.getByRole("cell").nth(column)).toHaveText("£" + tier.price);
    }
  }
  expect(Object.keys(product).sort()).toEqual(["@context", "@type", "name", "offers", "sku", "url"]);
});
