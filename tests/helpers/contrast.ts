import { expect, type Locator } from "@playwright/test";

export function contrast(first: string, second: string) {
  const weights = [0.2126, 0.7152, 0.0722];
  const luminance = (rgb: string) => {
    const channels = rgb.match(/\d+(?:\.\d+)?/g);
    if (!channels || channels.length < 3) throw new Error("Expected an RGB colour: " + rgb);
    return channels.slice(0, 3).reduce((total, channel, index) => {
      const value = Number(channel) / 255;
      return total + weights[index]! * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    }, 0);
  };
  const [a, b] = [luminance(first), luminance(second)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export async function expectControlBoundary(controls: Locator) {
  await expect(controls.first()).toBeVisible();
  const measured = await controls.evaluateAll(elements => elements.map((element) => {
    const transparent = "rgba(0, 0, 0, 0)";
    let surface = element.parentElement;
    while (surface && getComputedStyle(surface).backgroundColor === transparent) surface = surface.parentElement;
    const outside = getComputedStyle(surface ?? document.documentElement).backgroundColor;
    const style = getComputedStyle(element);
    return {
      name: element.getAttribute("aria-label") || element.getAttribute("name") || element.className,
      border: style.borderTopColor,
      width: parseFloat(style.borderTopWidth),
      outside,
      inside: style.backgroundColor === transparent ? outside : style.backgroundColor,
    };
  }));
  for (const { name, border, width, outside, inside } of measured) {
    expect(width, `${name}: painted boundary`).toBeGreaterThan(0);
    expect(contrast(border, outside), `${name}: border against surroundings`).toBeGreaterThanOrEqual(3);
    expect(contrast(border, inside), `${name}: border against fill`).toBeGreaterThanOrEqual(3);
  }
}
