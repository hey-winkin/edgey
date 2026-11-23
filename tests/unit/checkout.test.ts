import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteSelection } from "@/app/(shop)/checkout/actions";
import { prepareCheckoutAttempt } from "@/lib/checkout/attempt";
import { quoteSelectionWith, type QuoteDependencies } from "@/lib/checkout/quote";
import { startCheckoutAttempt } from "@/lib/checkout/server";
import type { CheckoutFields, QuoteResult } from "@/lib/checkout/types";
import {
  ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027, lookupDeliveryCoverage, PLACEHOLDER_DELIVERY_COVERAGE,
  STANDARD_DELIVERY_QUOTE, type LineRequest,
} from "@/lib/commerce";
import { parseDeliveryTerms, type DeliveryResolution } from "@/lib/delivery/terms";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
vi.mock("@/lib/delivery/bank-holidays", () => ({
  readBankHolidayDates: async () => ["2026-07-17", "2026-07-21"],
}));

const z10Id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const secondId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const missingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const attemptToken = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const londonFriday = "2026-07-17T14:29:00.123Z";
const terms = parseDeliveryTerms({
  version: 1,
  quote: STANDARD_DELIVERY_QUOTE,
  warehouseCalendar: ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027,
  deliveryCalendar: ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027,
  cutoffMinutes: 930,
});
if (!terms) throw new Error("Invalid test delivery terms.");
const calendar = { warehouseCalendar: terms.warehouseCalendar, cutoffMinutes: terms.cutoffMinutes };
const z10 = {
  id: z10Id,
  sku: "EDG-Z10",
  optionLabel: "36°",
  tierPrices: { oneToFour: 2250, fiveToNine: 1995, tenPlus: 1750 },
  availableQuantity: 72345,
  photo: "drag.webp",
};
const fields: CheckoutFields = {
  businessName: "  Acme   Print  ",
  buyingForWork: true,
  email: " SALES@ACME.EXAMPLE ",
  recipientName: "  Zoë Smith ",
  line1: "  10   High Street ",
  line2: " ",
  town: "London",
  region: "Greater London",
  postcode: "sw1a1aa",
};

function dependencies(
  variants: Awaited<ReturnType<QuoteDependencies["lookup"]>> = [z10],
  instant = londonFriday,
) {
  return {
    lookup: vi.fn<QuoteDependencies["lookup"]>(async (lines) => variants.filter(({ id }) => lines.some(({ variantId }) => variantId === id))),
    now: () => new Date(instant),
    readWarehouseSchedule: async () => calendar,
    resolveDelivery: async (postcode: string): Promise<DeliveryResolution> => {
      const coverage = lookupDeliveryCoverage(postcode, PLACEHOLDER_DELIVERY_COVERAGE);
      if (!coverage.ok) return coverage;
      return { ok: true, value: { postcode: coverage.value.postcode, terms: coverage.value.kind === "covered" ? terms : null } };
    },
  };
}

function line(quantity: number, variantId = z10Id): LineRequest {
  return { variantId, quantity };
}

function ok(quote: QuoteResult) {
  expect(quote.status).toBe("ok");
  if (quote.status !== "ok") throw new Error(quote.message);
  return quote;
}

function input(lines: LineRequest[], quoteKey: string) {
  return { attemptToken, lines, fields, quoteKey };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("selection quote", () => {
  it.each([
    [1, 2250, 2250, 695, 589, 3534],
    [4, 2250, 9000, 695, 1939, 11634],
    [5, 1995, 9975, 695, 2134, 12804],
    [9, 1995, 17955, 0, 3591, 21546],
    [10, 1750, 17500, 0, 3500, 21000],
  ])("prices %i EDG-Z10 blades at %i pence each", async (quantity, unit, goods, delivery, vat, gross) => {
    const quote = ok(await quoteSelectionWith([{ ...line(quantity), unitPricePence: 1 }], undefined, dependencies()));
    expect(quote.basket).toMatchObject({
      goodsNetPence: goods, delivery: { netPence: delivery }, totalVatPence: vat, totalGrossPence: gross,
      lines: [{ unitNetPence: unit, quantity }],
    });
    if (quantity === 9) {
      expect(quote.basket?.lines[0]?.savingPrompt?.message).toBe("Add one blade and save £4.55 ex VAT");
    }
  });

  it.each([[14999, 695, "£0.01 more ex VAT for free delivery"], [15000, 0, "Your basket qualifies for free delivery."]])(
    "quotes standard delivery at %i pence goods net", async (pence, delivery, message) => {
      const variant = { ...z10, tierPrices: { oneToFour: pence, fiveToNine: pence, tenPlus: pence } };
      const quote = ok(await quoteSelectionWith([line(1)], undefined, dependencies([variant])));
      expect(quote.basket?.delivery.netPence).toBe(delivery);
      expect(quote.freeDeliveryMessage).toBe(message);
    },
  );

  it("consolidates canonical variant IDs before pricing but does not share breaks across variants", async () => {
    const deps = dependencies([z10, { ...z10, id: secondId, sku: "EDG-SECOND" }]);
    const quote = ok(await quoteSelectionWith([line(2, ` ${z10Id.toUpperCase()} `), line(4, secondId), line(3)], undefined, deps));
    expect(deps.lookup).toHaveBeenCalledExactlyOnceWith([line(5), line(4, secondId)]);
    expect(quote.lines).toEqual([line(5), line(4, secondId)]);
    expect(quote.basket?.lines.map(({ unitNetPence }) => unitNetPence)).toEqual([1995, 2250]);
    const reordered = ok(await quoteSelectionWith([line(4, secondId), line(5)], undefined, deps));
    expect(reordered.quoteKey).toBe(quote.quoteKey);
  });

  it("corrects only the requested quantities and omits unavailable items from the quote", async () => {
    const deps = dependencies([
      { ...z10, availableQuantity: 4 }, { ...z10, id: secondId, sku: "EDG-SECOND", availableQuantity: 0 },
    ]);
    const quote = ok(await quoteSelectionWith([line(5), line(1, missingId), line(1, secondId)], undefined, deps));
    expect(quote.lines).toEqual([line(4)]);
    expect(quote.corrections).toEqual([
      "EDG-Z10: limited stock. We’ve suggested a smaller quantity for you to review.",
      "An unavailable item was removed from your basket.",
      "EDG-SECOND is out of stock and was removed from your basket.",
    ]);
    expect(quote.basket?.lines).toMatchObject([{ quantity: 4, unitNetPence: 2250, savingPrompt: null }]);
    expect(quote.photos).toEqual({ [z10Id]: "drag.webp" });
    expect(JSON.stringify(quote)).not.toMatch(/availableQuantity|stock_on_hand|stock_reserved/);
  });

  it("does not expose excess stock counts or arbitrary media and does not bind them into the key", async () => {
    const initial = ok(await quoteSelectionWith([line(9)], undefined, dependencies()));
    const other = ok(await quoteSelectionWith([line(9)], undefined, dependencies([
      { ...z10, availableQuantity: 10, photo: "../../private.webp" },
    ])));
    expect(JSON.stringify(initial)).not.toContain("72345");
    expect(other.photos).toBeUndefined();
    expect(other.quoteKey).toBe(initial.quoteKey);
  });

  it("returns an empty selection without lookup and fails closed on lookup exceptions or unexpected rows", async () => {
    const deps = dependencies();
    expect(await quoteSelectionWith([], undefined, deps)).toMatchObject({ status: "ok", lines: [], basket: null });
    expect(deps.lookup).not.toHaveBeenCalled();
    deps.lookup.mockRejectedValueOnce(new Error("secret backend details"));
    const error = await quoteSelectionWith([line(1)], undefined, deps);
    expect(error.status).toBe("error");
    expect(JSON.stringify(error)).not.toContain("secret backend details");
    deps.lookup.mockResolvedValueOnce([{ ...z10, id: secondId }]);
    expect(await quoteSelectionWith([line(1)], undefined, deps)).toMatchObject({ status: "error" });
    deps.lookup.mockResolvedValueOnce([z10, z10]);
    expect(await quoteSelectionWith([line(1)], undefined, deps)).toMatchObject({ status: "error" });
  });

  it.each([
    ["non-array", {}], ["invalid UUID", [line(1, `${z10Id},${secondId}`)]], ["fractional", [line(1.1)]],
    ["zero", [line(0)]], ["too large", [line(2_147_483_648)]], ["string", [{ ...line(1), quantity: "1" }]],
    ["duplicate total too large", [line(2_147_483_647), line(1)]], ["too many rows", Array(101).fill(line(1))],
  ])("rejects %s input before lookup", async (_name, lines) => {
    const deps = dependencies();
    expect(await quoteSelectionWith(lines, undefined, deps)).toMatchObject({ status: "error" });
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it("rejects invisible formatting and overlong email parts before querying stock", async () => {
    const deps = dependencies();
    const invalid = await prepareCheckoutAttempt({
      ...input([line(1)], ""),
      fields: { ...fields, businessName: "Hidden\u202E text", recipientName: "Name\u200B", email: "a".repeat(65) + "@example.com" },
    }, deps);
    expect(invalid).toMatchObject({ status: "invalid", errors: {
      businessName: expect.any(String), recipientName: expect.any(String), email: expect.any(String),
    } });
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "unchecked", undefined, null],
    [" sw1a1aa ", "covered", "SW1A 1AA", "2026-07-20"],
    ["bt1 5gs", "unsupported", "BT1 5GS", null],
    ["PO30 1AA", "unsupported", "PO30 1AA", null],
    ["not a postcode", "invalid", undefined, null],
    [123, "invalid", undefined, null],
  ])("quotes coverage for %s without claiming unverified delivery dates", async (postcode, coverage, canonical, estimate) => {
    const quote = ok(await quoteSelectionWith([line(1)], postcode, dependencies()));
    expect(quote).toMatchObject({ coverage, dispatchDate: "2026-07-17", estimatedDeliveryDate: estimate });
    expect(quote.postcode).toBe(canonical);
    if (coverage === "invalid" || coverage === "unsupported") expect(quote.freeDeliveryMessage).toBeNull();
  });

  it("uses only the configured warehouse cut-off and calendar without coverage, and doesn't invent dates without them", async () => {
    const deps = dependencies();
    const resolveDelivery = vi.fn(deps.resolveDelivery);
    const readWarehouseSchedule = vi.fn<QuoteDependencies["readWarehouseSchedule"]>()
      .mockResolvedValueOnce({
        cutoffMinutes: 900,
        warehouseCalendar: { ...calendar.warehouseCalendar, closures: ["2026-07-20"] },
      }).mockResolvedValueOnce(null);
    const scoped = { ...deps, resolveDelivery, readWarehouseSchedule };
    expect(await quoteSelectionWith([line(1)], undefined, scoped)).toMatchObject({
      coverage: "unchecked", dispatchDate: "2026-07-21", estimatedDeliveryDate: null,
    });
    expect(resolveDelivery).not.toHaveBeenCalled();
    expect(await quoteSelectionWith([line(1)], "", scoped)).toMatchObject({
      coverage: "unchecked", dispatchDate: null, dispatchTiming: null, estimatedDeliveryDate: null,
    });
  });

  it("keeps a quote stable as the countdown ages but changes it when dispatch rolls over", async () => {
    const deps = dependencies();
    const read = async (time: string) => ok(await quoteSelectionWith([line(1)], undefined, { ...deps, now: () => new Date(time) }));
    const before = await read("2026-07-17T14:27:00Z");
    const later = await read("2026-07-17T14:29:00Z");
    const after = await read("2026-07-17T14:30:00Z");
    expect(later.quoteKey).toBe(before.quoteKey);
    expect(later.dispatchTiming).toEqual({
      checkedAt: Date.parse("2026-07-17T14:29:00Z"),
      cutoffAt: Date.parse("2026-07-17T14:30:00Z"),
      validUntil: Date.parse("2026-07-17T14:30:00Z"),
    });
    expect(after.quoteKey).not.toBe(before.quoteKey);
    expect(after).toMatchObject({ dispatchDate: "2026-07-20", dispatchTiming: { cutoffAt: null } });
  });
});

describe("checkout attempt", () => {
  it("returns field errors without running an inventory query", async () => {
    const deps = dependencies();
    const result = await prepareCheckoutAttempt({ ...input([line(1)], ""), fields: {
      businessName: " ", buyingForWork: "true", email: "invalid@domain..example", recipientName: "x".repeat(201),
      line1: "Line\nBreak", line2: 123, town: "", region: "x".repeat(101), postcode: "INVALID",
    } }, deps);
    expect(result).toEqual({ status: "invalid", message: expect.any(String), errors: {
      businessName: expect.any(String), buyingForWork: expect.any(String), email: expect.any(String),
      recipientName: expect.any(String), line1: expect.any(String), line2: expect.any(String),
      town: expect.any(String), region: expect.any(String), postcode: expect.any(String),
    } });
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(await prepareCheckoutAttempt({ ...input([line(1)], ""), attemptToken: "untrusted" }, deps))
      .toMatchObject({ status: "error" });
    expect(deps.lookup).not.toHaveBeenCalled();
  });

  it("blocks unsupported delivery even with a previously quoted key", async () => {
    const deps = dependencies();
    const quote = ok(await quoteSelectionWith([line(1)], "BT1 5GS", deps));
    const result = await prepareCheckoutAttempt({ ...input([line(1)], quote.quoteKey), fields: { ...fields, postcode: "BT1 5GS" } }, deps);
    expect(result).toMatchObject({ status: "invalid", errors: { postcode: expect.stringContaining("Ask us") } });
  });

  it("requires corrected quantities as well as the matching key before building the order snapshot", async () => {
    const deps = dependencies([{ ...z10, availableQuantity: 4 }]);
    const quote = ok(await quoteSelectionWith([line(5)], fields.postcode, deps));
    expect(quote.corrections).not.toHaveLength(0);
    expect(await prepareCheckoutAttempt(input([line(5)], quote.quoteKey), deps)).toMatchObject({ status: "review", quote });
    expect(await prepareCheckoutAttempt(input(quote.lines, quote.quoteKey), deps)).toMatchObject({ status: "ready" });
    const unavailable = await prepareCheckoutAttempt(input([line(1)], quote.quoteKey), dependencies([]));
    expect(unavailable).toMatchObject({ status: "review", quote: { status: "ok", basket: null, lines: [] } });
    expect(await prepareCheckoutAttempt(input([], quote.quoteKey), deps)).toMatchObject({ status: "error" });
  });

  it("requires review when exact priced lines change even if the gross total matches", async () => {
    const lines = [line(1), line(1, secondId)];
    const variant = (id: string, single: number) => ({ ...z10, id, tierPrices: { ...z10.tierPrices, oneToFour: single } });
    const original = ok(await quoteSelectionWith(lines, fields.postcode, dependencies([variant(z10Id, 2250), variant(secondId, 2250)])));
    const revised = await prepareCheckoutAttempt(input(lines, original.quoteKey), dependencies([variant(z10Id, 2300), variant(secondId, 2200)]));
    expect(revised.status).toBe("review");
    if (revised.status !== "review") return;
    expect(ok(revised.quote).basket?.totalGrossPence).toBe(original.basket?.totalGrossPence);
    expect(ok(revised.quote).quoteKey).not.toBe(original.quoteKey);
  });

  it("binds normalised postcode and London cutoff dates to the acknowledgement", async () => {
    const lines = [line(1)];
    const deps = dependencies();
    const quote = ok(await quoteSelectionWith(lines, "  SW1A 1AA  ", deps));
    expect(await prepareCheckoutAttempt(input(lines, quote.quoteKey), deps)).toMatchObject({ status: "ready" });
    expect(await prepareCheckoutAttempt({ ...input(lines, quote.quoteKey), fields: { ...fields, postcode: "SW1A 2AA" } }, deps))
      .toMatchObject({ status: "review", quote: { postcode: "SW1A 2AA" } });
    expect(await prepareCheckoutAttempt(input(lines, quote.quoteKey), dependencies([z10], "2026-07-17T14:30:00Z")))
      .toMatchObject({ status: "review", quote: { dispatchDate: "2026-07-20", estimatedDeliveryDate: "2026-07-21" } });
  });

  it.each([
    ["2027-12-31T10:00:00Z", "2027-12-31"],
    ["2028-01-04T10:00:00Z", null],
  ])("allows browsing but not ordering when dates are out of calendar range at %s", async (time, dispatchDate) => {
    const deps = dependencies([z10], time);
    const quote = ok(await quoteSelectionWith([line(1)], fields.postcode, deps));
    expect(quote).toMatchObject({ basket: { goodsNetPence: 2250 }, dispatchDate, estimatedDeliveryDate: null });
    expect(await prepareCheckoutAttempt(input([line(1)], quote.quoteKey), deps)).toMatchObject({ status: "error" });
  });

  it("produces only authoritative prices, normalised snapshots, and a whole-second reservation deadline", async () => {
    const deps = dependencies();
    const quote = ok(await quoteSelectionWith([line(5)], fields.postcode, deps));
    const result = await prepareCheckoutAttempt({ ...input([line(5)], quote.quoteKey),
      attemptToken: attemptToken.toUpperCase(),
      buyerId: secondId,
      lines: [{ ...line(5), unitPricePence: 1 }],
      fields: { ...fields, country: "US" },
      totals: { grossPence: 1 },
    }, deps);
    expect(result).toEqual({ status: "ready", quote, orderInput: {
      attemptToken,
      lines: [{ variantId: z10Id, quantity: 5, unitPricePence: 1995 }],
      contact: { email: "sales@acme.example", businessName: "Acme Print", recipientName: "Zoë Smith", buyingForWork: true },
      address: { line1: "10 High Street", line2: undefined, town: "London", region: "Greater London", postcode: "SW1A 1AA", country: "GB" },
      totals: { goodsNetPence: 9975, deliveryNetPence: 695, vatRateBps: 2000, vatPence: 2134, grossPence: 12804 },
      holdExpiresAt: "2026-07-17T15:04:00.000Z",
      deliveryService: "Next working day",
      deliveryTerms: terms,
      promise: { dispatchDate: "2026-07-17", deliveryDate: "2026-07-20" },
    } });
  });

  it("requires a fresh acknowledgement after terms change even if the quoted dates and price do not", async () => {
    const deps = dependencies();
    const original = ok(await quoteSelectionWith([line(1)], fields.postcode, deps));
    const revised: QuoteDependencies = { ...deps, resolveDelivery: async (postcode) => {
      const result = await deps.resolveDelivery(postcode);
      if (!result.ok || !result.value.terms) throw new Error("Fixture must be covered.");
      return { ok: true, value: {
        ...result.value, terms: { ...result.value.terms, cutoffMinutes: 931 },
      } };
    } };
    const next = ok(await quoteSelectionWith([line(1)], fields.postcode, revised));
    expect(next.dispatchDate).toBe(original.dispatchDate);
    expect(next.estimatedDeliveryDate).toBe(original.estimatedDeliveryDate);
    expect(next.basket).toEqual(original.basket);
    expect(await prepareCheckoutAttempt(input([line(1)], original.quoteKey), revised)).toMatchObject({ status: "review", quote: next });
  });
});

describe("live checkout adapter", () => {
  const row = {
    id: z10Id, sku: z10.sku, option_label: z10.optionLabel, price_1_4_pence: 2250, price_5_9_pence: 1995,
    price_10_plus_pence: 1750, quote_limit: 10, photo: "drag.webp",
  };

  function mockSupabase() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fake-anonymous-key");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3000");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-service-role-key");
    vi.stubEnv("EDGEY_REQUEST_HASH_KEY", "test-only-request-hash-key-at-least-32-bytes");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(londonFriday));
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (target) => {
      const path = new URL(String(target)).pathname;
      return Response.json(path.endsWith("/consume_request_rate_limit") ? true : path.endsWith("/checkout_delivery_terms") ? terms :
        path.endsWith("/checkout_warehouse_calendar") ? calendar :
        path.endsWith("/variants") ? [{ id: z10Id, products: { name: "Flat-stock drag blade" } }] : [row]);
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("only fetches requested published variants without caching or exposing stock or the order input", async () => {
    const fetch = mockSupabase();
    const quote = ok(await quoteSelection([line(2), line(3, z10Id.toUpperCase())], fields.postcode, true));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/rpc\/consume_request_rate_limit$/);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ p_scope: "selection_quote" });
    const [, deliveryCall, call, namesCall] = fetch.mock.calls;
    expect(new URL(String(deliveryCall?.[0])).pathname).toBe("/rest/v1/rpc/checkout_delivery_terms");
    expect(deliveryCall?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({
      p_postcode: "SW1A 1AA", p_official_bank_holidays: ["2026-07-17", "2026-07-21"],
    }) });
    if (!call) throw new Error("No request was made");
    const [target, init] = call;
    const url = new URL(String(target));
    expect(url.pathname).toBe("/rest/v1/rpc/lookup_selection_quote");
    expect(JSON.parse(String(init?.body))).toEqual({ p_variant_ids: [z10Id], p_quantities: [5] });
    expect(init).toMatchObject({ method: "POST", cache: "no-store" });
    expect(new Headers(init?.headers).get("apikey")).toBe("fake-service-role-key");
    const namesUrl = new URL(String(namesCall?.[0]));
    expect(namesUrl.pathname).toBe("/rest/v1/variants");
    expect(Object.fromEntries(namesUrl.searchParams)).toEqual({
      select: "id,products!inner(name)", publication_status: "eq.published", id: `in.(${z10Id})`,
    });
    expect(namesCall?.[1]?.method).toBe("GET");
    expect(new Headers(namesCall?.[1]?.headers).get("apikey")).toBe("fake-anonymous-key");
    expect(quote.photos).toEqual({ [z10Id]: "drag.webp" });
    expect(quote.productNames).toEqual({ [z10Id]: "Flat-stock drag blade" });
    expect(JSON.stringify(quote)).not.toMatch(/75321|4098|71223|service-role|quote_limit|stock_on_hand|stock_reserved|warehouseCalendar|cutoffMinutes/);
    expect(await startCheckoutAttempt(input([line(5)], quote.quoteKey))).toMatchObject({
      status: "ready", orderInput: { totals: { grossPence: 12804 } },
    });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(fetch.mock.calls.slice(4).map(([, init]) => init?.method)).toEqual(["POST", "POST"]);
  });

  it("keeps the same usable quote and fingerprint when the name lookup fails", async () => {
    const fetch = mockSupabase();
    const named = ok(await quoteSelection([line(1)], fields.postcode, true));
    fetch.mockResolvedValueOnce(Response.json(true));
    fetch.mockResolvedValueOnce(Response.json(terms));
    fetch.mockResolvedValueOnce(Response.json([row]));
    fetch.mockResolvedValueOnce(Response.json({ message: "restricted provider error" }, { status: 500 }));
    const unnamed = ok(await quoteSelection([line(1)], fields.postcode, true));
    const { productNames, ...baseQuote } = named;
    expect(productNames).toEqual({ [z10Id]: "Flat-stock drag blade" });
    expect(unnamed).toEqual(baseQuote);
    fetch.mockClear();
    expect(ok(await quoteSelection([line(1)], fields.postcode))).toEqual(baseQuote);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects oversized or throttled public quotes without reading inventory", async () => {
    const fetch = mockSupabase();
    expect(await quoteSelection(Array(101).fill(line(1)))).toMatchObject({ status: "error" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(Response.json(false));
    expect(await quoteSelection([line(1)])).toMatchObject({ status: "error", message: expect.stringContaining("Too many") });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prices more than 32 different items up to the existing 100-line checkout input limit", async () => {
    const fetch = mockSupabase();
    const variants = Array.from({ length: 100 }, (_, index) => ({
      ...row, id: z10Id.slice(0, -3) + index.toString(16).padStart(3, "0"),
    }));
    fetch.mockResolvedValueOnce(Response.json(true));
    fetch.mockResolvedValueOnce(Response.json(variants));
    const quote = ok(await quoteSelection(variants.map(({ id }) => line(1, id))));
    expect(quote.lines).toHaveLength(100);
    expect(quote.basket?.lines).toHaveLength(100);
  });

  it("fails closed for unavailable credentials, query errors or malformed stock data", async () => {
    const fetch = mockSupabase();
    fetch.mockResolvedValueOnce(Response.json(true));
    fetch.mockResolvedValueOnce(Response.json({ message: "restricted provider error" }, { status: 500 }));
    const error = await quoteSelection([line(1)]);
    expect(error).toMatchObject({ status: "error" });
    expect(JSON.stringify(error)).not.toContain("restricted provider error");
    fetch.mockResolvedValueOnce(Response.json(true));
    fetch.mockResolvedValueOnce(Response.json([{ ...row, quote_limit: null }]));
    expect(await quoteSelection([line(1)])).toEqual(error);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    expect(await quoteSelection([line(1)])).toEqual(error);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("reads only the narrow warehouse schedule when the buyer has not entered a postcode", async () => {
    const fetch = mockSupabase();
    const quote = ok(await quoteSelection([line(1)]));
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/rest/v1/rpc/consume_request_rate_limit", "/rest/v1/rpc/lookup_selection_quote", "/rest/v1/rpc/checkout_warehouse_calendar",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      p_official_bank_holidays: ["2026-07-17", "2026-07-21"],
    });
    expect(quote).toMatchObject({ coverage: "unchecked", dispatchDate: "2026-07-17", estimatedDeliveryDate: null });
    expect(JSON.stringify(quote)).not.toMatch(/warehouseCalendar|cutoffMinutes/);
  });

  it("calculates new dispatch and delivery dates using the merged RPC calendars", async () => {
    const fetch = mockSupabase();
    fetch.mockResolvedValueOnce(Response.json(true));
    fetch.mockResolvedValueOnce(Response.json({
      ...terms,
      warehouseCalendar: { ...terms.warehouseCalendar, bankHolidays: ["2026-07-17"] },
      deliveryCalendar: { ...terms.deliveryCalendar, bankHolidays: ["2026-07-21"] },
    }));
    const quote = ok(await quoteSelection([line(1)], fields.postcode));
    expect(quote).toMatchObject({ dispatchDate: "2026-07-20", estimatedDeliveryDate: "2026-07-22" });
  });
});
