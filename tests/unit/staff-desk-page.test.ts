import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import AdminPage from "@/app/admin/page";

const { staffDeskCounts } = vi.hoisted(() => ({ staffDeskCounts: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ requireStaff: async () => ({ roles: ["warehouse"] }) }));
vi.mock("@/lib/admin/desk", () => ({ staffDeskCounts }));
vi.mock("@/lib/admin/running-low", () => ({}));

test.each([
  [0, "No new sales orders"],
  [null, "New sales orders"],
] as const)("keeps the sales queue available when its count is %s", async (orders, label) => {
  staffDeskCounts.mockResolvedValue({ orders, requests: 0, trialFollowUps: 0, outOfStock: 0 });
  const html = renderToStaticMarkup(await AdminPage());
  expect(html).toMatch(new RegExp(`<a[^>]*class="primary"[^>]*href="/admin/warehouse"[^>]*>${label}</a>`));
  if (orders === null) {
    expect(html).toContain('aria-describedby="staff-sales-count-status"');
    expect(html).toMatch(/<p id="staff-sales-count-status"[^>]*>Count unavailable<\/p>/);
    expect(html).not.toContain("caught up");
  } else {
    expect(html).not.toContain('aria-describedby="staff-sales-count-status"');
  }
});

test("adds a due trial reminder to Sales orders", async () => {
  staffDeskCounts.mockResolvedValue({ orders: 0, requests: 0, trialFollowUps: 2, outOfStock: 0 });
  const html = renderToStaticMarkup(await AdminPage());
  expect(html).toMatch(/id="staff-desk-sales-orders"[^]*href="\/admin\/requests\/trial-follow-ups"[^]*>2<\/span> <span>trial follow-ups due<\/span>/);
  expect(html).not.toContain("caught up");
});
