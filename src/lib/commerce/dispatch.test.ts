import { describe, expect, it } from "vitest";
import {
  calculateDispatchPromise,
  ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027,
  STANDARD_DELIVERY_QUOTE,
  type WorkingDayCalendar,
} from "./index";
import { calculateDispatchDetails } from "./dispatch";

function promiseAt(authorisedAt: string) {
  return calculateDispatchPromise({ authorisedAt, deliveryQuote: STANDARD_DELIVERY_QUOTE });
}

describe("working-day dispatch in Europe/London", () => {
  it("dispatches same day at 15:29 UK time in GMT", () => {
    expect(promiseAt("2026-11-19T15:29:59.999Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-11-19", estimatedDeliveryDate: "2026-11-20" },
    });
  });

  it("dispatches next working day from 15:30 UK time in GMT", () => {
    expect(promiseAt("2026-11-19T15:30:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-11-20", estimatedDeliveryDate: "2026-11-23" },
    });
  });

  it("dispatches a qualifying Friday order on Friday for Monday delivery", () => {
    expect(promiseAt("2026-11-20T15:29:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-11-20", estimatedDeliveryDate: "2026-11-23" },
    });
  });

  it("dispatches a Friday order at the cutoff on Monday for Tuesday delivery", () => {
    expect(promiseAt("2026-11-20T15:30:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-11-23", estimatedDeliveryDate: "2026-11-24" },
    });
  });

  it("skips a Monday bank holiday for both dispatch and delivery", () => {
    expect(promiseAt("2026-08-28T14:29:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-08-28", estimatedDeliveryDate: "2026-09-01" },
    });
    expect(promiseAt("2026-08-31T08:00:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-09-01", estimatedDeliveryDate: "2026-09-02" },
    });
  });

  it("skips the 2027 Christmas and Boxing Day substitute holidays", () => {
    expect(promiseAt("2027-12-24T15:30:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2027-12-29", estimatedDeliveryDate: "2027-12-30" },
    });
  });

  it("contains all 16 published England and Wales bank holidays for 2026–2027", () => {
    expect(ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027.bankHolidays).toEqual([
      "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
      "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
    ]);
  });

  it.each([
    ["2026-04-02T14:29:00Z", "2026-04-02", "2026-04-07"],
    ["2027-03-25T15:29:00Z", "2027-03-25", "2027-03-30"],
    ["2026-12-24T15:29:00Z", "2026-12-24", "2026-12-29"],
    ["2026-12-31T15:29:00Z", "2026-12-31", "2027-01-04"],
  ])("skips consecutive closed days when dispatching at %s", (authorisedAt, dispatchDate, estimatedDeliveryDate) => {
    expect(promiseAt(authorisedAt)).toEqual({ ok: true, value: { dispatchDate, estimatedDeliveryDate } });
  });

  it("handles the spring clock-change weekend and then uses the BST cutoff", () => {
    expect(promiseAt("2026-03-27T15:29:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-03-27", estimatedDeliveryDate: "2026-03-30" },
    });
    for (const instant of ["2026-03-29T00:59:59Z", "2026-03-29T01:00:00Z", "2026-03-30T14:29:00Z"]) {
      expect(promiseAt(instant)).toEqual({
        ok: true, value: { dispatchDate: "2026-03-30", estimatedDeliveryDate: "2026-03-31" },
      });
    }
    expect(promiseAt("2026-03-30T14:30:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-03-31", estimatedDeliveryDate: "2026-04-01" },
    });
  });

  it("handles the autumn clock-change weekend and then uses the GMT cutoff", () => {
    expect(promiseAt("2026-10-23T14:29:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-10-23", estimatedDeliveryDate: "2026-10-26" },
    });
    for (const instant of ["2026-10-25T00:15:00Z", "2026-10-25T01:15:00Z", "2026-10-26T15:29:00Z"]) {
      expect(promiseAt(instant)).toEqual({
        ok: true, value: { dispatchDate: "2026-10-26", estimatedDeliveryDate: "2026-10-27" },
      });
    }
    expect(promiseAt("2026-10-26T15:30:00Z")).toEqual({
      ok: true, value: { dispatchDate: "2026-10-27", estimatedDeliveryDate: "2026-10-28" },
    });
  });

  it.each([
    ["2026-03-27T13:20:00Z", "2026-03-27T15:30:00Z"],
    ["2026-03-30T12:20:00Z", "2026-03-30T14:30:00Z"],
    ["2026-10-23T12:20:00Z", "2026-10-23T14:30:00Z"],
    ["2026-10-26T13:20:00Z", "2026-10-26T15:30:00Z"],
  ])("exposes the same dispatch cutoff at %s", (authorisedAt, cutoff) => {
    const cutoffAt = Date.parse(cutoff);
    expect(calculateDispatchDetails({ authorisedAt })).toEqual({
      ok: true,
      value: {
        dispatchDate: authorisedAt.slice(0, 10),
        estimatedDeliveryDate: null,
        dispatchTiming: { checkedAt: Date.parse(authorisedAt), cutoffAt, validUntil: cutoffAt },
      },
    });
  });

  it.each([
    ["2026-03-29T00:59:59.999Z", "2026-03-29T01:00:00Z", "2026-03-29T01:00:00Z", "2026-03-30"],
    ["2026-10-25T00:29:59.999Z", "2026-10-25T00:30:00Z", "2026-10-25T01:15:00Z", "2026-10-26"],
  ])("has a single cutoff on a working clock-change Sunday starting at %s", (before, cutoff, after, nextDay) => {
    const warehouseCalendar: WorkingDayCalendar = {
      ...ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027, workingWeekdays: [0, 1, 2, 3, 4, 5, 6],
    };
    const input = { warehouseCalendar, cutoffMinutes: 90 };
    expect(calculateDispatchDetails({ ...input, authorisedAt: before })).toMatchObject({
      ok: true, value: { dispatchTiming: { cutoffAt: Date.parse(cutoff), validUntil: Date.parse(cutoff) } },
    });
    for (const authorisedAt of [cutoff, after]) {
      expect(calculateDispatchDetails({ ...input, authorisedAt })).toMatchObject({
        ok: true, value: { dispatchDate: nextDay, dispatchTiming: { cutoffAt: null } },
      });
    }
  });

  it("expires the next-date message at London midnight, not UTC midnight", () => {
    expect(calculateDispatchDetails({ authorisedAt: "2026-08-31T12:00:00Z" })).toMatchObject({
      ok: true, value: {
        dispatchDate: "2026-09-01",
        dispatchTiming: { cutoffAt: null, validUntil: Date.parse("2026-08-31T23:00:00Z") },
      },
    });
  });

  it("counts agreed working days using independent warehouse and carrier closures", () => {
    const defaults = ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027;
    expect(calculateDispatchPromise({
      authorisedAt: "2026-11-20T15:29:00Z",
      warehouseCalendar: { ...defaults, closures: ["2026-11-20", "2026-11-25"] },
      deliveryCalendar: { ...defaults, closures: ["2026-11-24"] },
      deliveryQuote: { kind: "agreed", serviceName: "Highland delivery", workingDays: 2, chargeExVatPence: 1_250 },
    })).toEqual({ ok: true, value: { dispatchDate: "2026-11-23", estimatedDeliveryDate: "2026-11-26" } });
  });

  it("accepts nonstandard working weekdays and returns no estimate without a quote", () => {
    const warehouseCalendar: WorkingDayCalendar = {
      workingWeekdays: [2, 3, 4, 5, 6], closures: [], bankHolidays: [],
      dateRange: { from: "2026-11-20", through: "2026-11-21" },
    };
    expect(calculateDispatchPromise({ authorisedAt: "2026-11-21T14:00:00Z", warehouseCalendar })).toEqual({
      ok: true, value: { dispatchDate: "2026-11-21", estimatedDeliveryDate: null },
    });
  });

  it("does not make a promise outside the supplied calendar's date range", () => {
    expect(promiseAt("2025-12-31T16:00:00Z")).toEqual({
      ok: false, error: { code: "calendar_out_of_range", calendar: "warehouse" },
    });
    expect(promiseAt("2027-12-31T16:00:00Z")).toEqual({
      ok: false, error: { code: "calendar_out_of_range", calendar: "warehouse" },
    });
    expect(promiseAt("2027-12-31T15:29:00Z")).toEqual({
      ok: false, error: { code: "calendar_out_of_range", calendar: "delivery" },
    });
  });

  it.each(["not a date", "2026-11-20", "2026-11-20T15:29:00", "2026-02-30T15:29:00Z", "2026-11-20T24:00:00Z"])(
    "rejects an ambiguous or invalid authorisation timestamp: %s",
    (authorisedAt) => {
      expect(promiseAt(authorisedAt)).toEqual({ ok: false, error: { code: "invalid_authorised_at" } });
    },
  );

  it("rejects an unusable calendar and a quote with an undefined transit promise", () => {
    const warehouseCalendar = { ...ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027, workingWeekdays: [] };
    expect(calculateDispatchPromise({ authorisedAt: "2026-11-20T15:29:00Z", warehouseCalendar })).toEqual({
      ok: false, error: { code: "invalid_calendar", calendar: "warehouse" },
    });
    expect(calculateDispatchPromise({
      authorisedAt: "2026-11-20T15:29:00Z",
      deliveryQuote: { kind: "agreed", serviceName: "Slow delivery", chargeExVatPence: 695, workingDays: 0 },
    })).toEqual({ ok: false, error: { code: "invalid_delivery_quote" } });
  });
});
