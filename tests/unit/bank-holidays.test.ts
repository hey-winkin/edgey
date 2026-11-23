import { afterEach, expect, test, vi } from "vitest";
import { otherClosureDates, readBankHolidayDates, readBankHolidays } from "@/lib/delivery/bank-holidays";
import snapshot from "@/lib/delivery/bank-holidays.snapshot.json";

vi.mock("server-only", () => ({}));
const cacheRead = vi.hoisted(() => vi.fn<(load: () => Promise<unknown>) => Promise<unknown>>((load) => load()));
vi.mock("next/cache", () => ({
  unstable_cache: (load: () => Promise<unknown>) => () => cacheRead(load),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  cacheRead.mockReset().mockImplementation((load) => load());
});

const event = { date: "2027-03-26", title: "Good Friday", notes: "" };
const inYear = (year: string) => snapshot.events.filter(({ date }) => date.startsWith(year));
const feed = (events: unknown[]) => ({
  "england-and-wales": { division: "england-and-wales", events },
  scotland: { division: "scotland", events: [{ date: "2027-01-04", title: "2nd January", notes: "Substitute day" }] },
});

test("loads only named England and Wales dates and records when they were retrieved", async () => {
  const extra = { date: "2027-06-18", title: "Extra holiday from the live feed", notes: "" };
  const request = vi.fn(async () => Response.json(feed([...inYear("2027").reverse(), extra])));
  vi.stubGlobal("fetch", request);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T12:34:56Z"));

  const result = await readBankHolidays();
  expect(result).toMatchObject({ refreshedAt: "2026-11-24T12:34:56.000Z", source: "gov.uk" });
  expect(result.events).toEqual([...snapshot.events, extra].sort((a, b) => a.date.localeCompare(b.date)));
  expect(result.supplementedDates).toContain("2026-12-25");
  expect(result.supplementedDates).not.toContain(event.date);
  expect(result.events.some(({ date }) => date === "2027-01-04")).toBe(false);
  expect(request).toHaveBeenCalledWith(snapshot.source, {
    cache: "no-store", signal: expect.any(AbortSignal),
  });
});

test("supplements a partial year and still uses dates that GOV.UK has published for it", async () => {
  const extra = { date: "2027-11-23", title: "Additional holiday", notes: "" };
  vi.stubGlobal("fetch", async () => Response.json(feed([...inYear("2026"), event, extra])));
  const result = await readBankHolidays();
  expect(result).toMatchObject({ source: "gov.uk" });
  expect(result.supplementedDates).toContain("2027-12-27");
  expect(result.supplementedDates).not.toContain(event.date);
  expect(result.events.filter(({ date }) => date.startsWith("2027")))
    .toEqual([...inYear("2027"), extra].sort((a, b) => a.date.localeCompare(b.date)));
});

test.each([
  ["network error", () => Promise.reject(new Error("timed out"))],
  ["HTTP failure", () => Promise.resolve(new Response(null, { status: 503 }))],
  ["non-JSON response", () => Promise.resolve(new Response("<html>unavailable</html>"))],
  ["missing region", () => Promise.resolve(Response.json({ scotland: feed([]).scotland }))],
  ["empty region", () => Promise.resolve(Response.json(feed([])))],
  ["no complete year", () => Promise.resolve(Response.json(feed([event])))],
  ["invalid date", () => Promise.resolve(Response.json(feed([{ ...event, date: "2027-02-30" }])))],
] as const)("uses the bundled GOV.UK data on %s", async (_, fetch) => {
  vi.stubGlobal("fetch", fetch);
  const result = await readBankHolidays();
  expect(result).toEqual({ events: snapshot.events, refreshedAt: snapshot.refreshedAt, source: "snapshot", supplementedDates: [] });
  const dates = await readBankHolidayDates();
  for (const year of ["2026", "2027"]) expect(dates.filter((date) => date.startsWith(year))).toHaveLength(8);
  expect(result.events).toContainEqual({ date: "2027-12-27", title: "Christmas Day", notes: "Substitute day" });
});

test("keeps manual closures and surfaces old dates missing from the feed or bundled fallback", () => {
  expect(otherClosureDates({
    bank_holidays: ["2026-12-25", "2026-12-24", "2026-12-29", "2026-05-25"],
    closures: ["2026-12-29", "2026-12-28"],
  }, new Set(["2026-12-25", "2026-12-28", "2026-12-24"]))).toEqual([
    "2026-05-25", "2026-12-24", "2026-12-28", "2026-12-29",
  ]);
});

test("makes a snapshot fallback cacheable so repeated quote reads avoid the unavailable feed", async () => {
  let cached: unknown;
  cacheRead.mockImplementation(async (load) => cached ??= await load());
  const request = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", request);
  expect((await readBankHolidays()).source).toBe("snapshot");
  await expect(readBankHolidayDates()).resolves.toContain("2027-12-27");
  expect(request).toHaveBeenCalledTimes(1);
});
