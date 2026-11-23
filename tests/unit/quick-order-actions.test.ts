import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkQuickOrder, confirmQuickOrder } from "@/app/(shop)/quick-order/actions";
import { searchExactBladeCodes } from "@/lib/catalogue/server";
import { allowSelectionQuote } from "@/lib/requests/rate-limit";

vi.mock("@/lib/catalogue/server", () => ({ searchExactBladeCodes: vi.fn() }));
vi.mock("@/lib/catalogue/supabase", () => ({ publicClient: vi.fn() }));
vi.mock("@/lib/checkout/server", () => ({ lookupSelectionVariants: vi.fn() }));
vi.mock("@/lib/requests/rate-limit", () => ({ allowSelectionQuote: vi.fn() }));

const valid = { number: 1, code: "3910301", quantity: 5, variantId: "bc22d4ef-e2f6-472e-878c-fef9b8c759fb", chosen: false };

beforeEach(() => vi.resetAllMocks());

describe("quick order actions", () => {
  it.each([
    [{ ...valid, variantId: "not-a-uuid" }],
    [valid, { ...valid, quantity: 1 }],
    Array.from({ length: 26 }, (_, index) => ({ ...valid, number: index + 1 })),
  ].map((batch) => [batch]))("rejects an invalid confirmation batch before any lookup", async (batch) => {
    expect(await confirmQuickOrder(batch, [])).toMatchObject({ error: expect.any(String) });
    expect(allowSelectionQuote).not.toHaveBeenCalled();
    expect(searchExactBladeCodes).not.toHaveBeenCalled();
  });

  it("does not send lookup requests if the quote budget is exhausted", async () => {
    vi.mocked(allowSelectionQuote).mockResolvedValue(false);
    const form = new FormData();
    form.set("lines", "3910301,5");
    expect(await checkQuickOrder({ id: "", text: "", rows: [] }, form)).toMatchObject({
      error: "There have been too many checks. Try again later.", text: "3910301,5", rows: [],
    });
    expect(await confirmQuickOrder([valid], [])).toMatchObject({ error: "There have been too many checks. Try again later." });
    expect(searchExactBladeCodes).not.toHaveBeenCalled();
  });

  it("rejects basket data it cannot price instead of using an empty basket", async () => {
    vi.mocked(allowSelectionQuote).mockResolvedValue(true);
    const form = new FormData();
    form.set("lines", "3910301,5");
    form.set("basket", "0".repeat(9_001));
    expect(await checkQuickOrder({ id: "", text: "", rows: [] }, form)).toMatchObject({
      error: "We couldn’t read your basket. Check it and try again.", rows: [],
    });
    expect(searchExactBladeCodes).not.toHaveBeenCalled();
  });
});
