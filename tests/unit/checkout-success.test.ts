import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import CheckoutSuccessPage from "@/app/(shop)/checkout/success/page";
import { readCheckoutSuccess } from "@/lib/payments/success";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/payments/success", () => ({ readCheckoutSuccess: vi.fn() }));
vi.mock("@/components/selection-provider", () => ({ useSelection: () => ({ hydrated: false }) }));

const read = vi.mocked(readCheckoutSuccess);

async function render(session_id?: string | string[]) {
  return renderToStaticMarkup(await CheckoutSuccessPage({ searchParams: Promise.resolve({ session_id }) }));
}

afterEach(() => read.mockReset());

describe("checkout success page", () => {
  it.each([
    { scope: undefined },
    { scope: "cs_test_short" },
    { scope: "EDG-00000042" },
    { scope: ["cs_test_session1", "cs_test_session2"] },
  ])(
    "never reads order data for an invalid session scope ($scope)",
    async ({ scope }) => {
      expect(await render(scope)).toContain("Checkout not found");
      expect(read).not.toHaveBeenCalled();
    },
  );

  it.each([
    [null, "Checkout not found"],
    [{ kind: "pending" }, "Confirming payment"],
    [{ kind: "review" }, "Your payment is under review"],
    [{ kind: "expired" }, "This checkout has expired"],
  ] as const)("renders a text-only status for %j", async (status, heading) => {
    read.mockResolvedValueOnce(status);
    const markup = await render("cs_test_session1");
    expect(markup).toContain(heading);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("Order summary");
    expect(markup).not.toContain("cs_test_session1");
    expect(read).toHaveBeenCalledExactlyOnceWith("cs_test_session1");
  });

  it("does not expose provider errors", async () => {
    read.mockRejectedValueOnce(new Error("Internal provider detail"));
    const markup = await render("cs_test_session1");
    expect(markup).toContain("We can’t check your payment right now");
    expect(markup).not.toContain("Internal provider detail");
    expect(markup).not.toContain("Order summary");
  });

  it("renders only the scoped confirmation and immutable order amounts", async () => {
    const paidOrder = {
      kind: "confirmed" as const,
      reference: "EDG-00000042",
      deliveryService: "Next working day",
      dispatchDate: "2026-11-23",
      deliveryDate: "2026-11-24",
      vatRateBps: 2000,
      goodsNetPence: 9975,
      deliveryNetPence: 695,
      vatPence: 2134,
      grossPence: 12804,
      lines: [{ variantId: "variant-1", sku: "EDG-Z10", optionLabel: "Flat-stock blade", quantity: 5, unitPricePence: 1995, netPence: 9975 }],
      email: "guest@example.invalid",
    };
    read.mockResolvedValueOnce(paidOrder);
    const markup = await render("cs_test_session1");
    for (const text of [
      "Order confirmed", paidOrder.reference, "Monday, 23 November 2026", "Tuesday, 24 November 2026", "Next working day",
      "EDG-Z10", "Flat-stock blade", "5 × £19.95 ex VAT", "£99.75", "£6.95", "VAT (20%)", "£21.34", "£128.04",
    ]) {
      expect(markup).toContain(text);
    }
    expect(markup).not.toContain("cs_test_session1");
    expect(markup).not.toContain(paidOrder.email);
  });
});
