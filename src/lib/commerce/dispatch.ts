import { isValidDeliveryQuote, type DeliveryQuote } from "./delivery";
import type { CommerceResult } from "./money";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type WorkingDayCalendar = Readonly<{
  workingWeekdays: readonly Weekday[];
  bankHolidays: readonly string[];
  closures: readonly string[];
  dateRange: Readonly<{ from: string; through: string }>;
}>;

export const ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027 = Object.freeze({
  workingWeekdays: Object.freeze([1, 2, 3, 4, 5] as const),
  bankHolidays: Object.freeze([
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04",
    "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03",
    "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  ]),
  closures: Object.freeze([]),
  dateRange: Object.freeze({ from: "2026-01-01", through: "2027-12-31" }),
} satisfies WorkingDayCalendar);

export type DispatchInput = Readonly<{
  authorisedAt: string;
  deliveryQuote?: DeliveryQuote | null;
  warehouseCalendar?: WorkingDayCalendar;
  deliveryCalendar?: WorkingDayCalendar;
  cutoffMinutes?: number;
}>;

export type DispatchPromise = { dispatchDate: string; estimatedDeliveryDate: string | null };

export type DispatchTiming = { checkedAt: number; cutoffAt: number | null; validUntil: number };

export type DispatchError =
  | { code: "invalid_authorised_at" }
  | { code: "invalid_delivery_quote" }
  | { code: "invalid_calendar" | "calendar_out_of_range"; calendar: "warehouse" | "delivery" };

const londonDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  calendar: "iso8601",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayMilliseconds = 86_400_000;
const minuteMilliseconds = 60_000;

function londonWallMinute(timestamp: number): number {
  const { year, month, day, hour, minute } = Object.fromEntries(
    londonDateTime.formatToParts(timestamp).map(({ type, value }) => [type, value]),
  );
  if (!year || !month || !day || !hour || !minute) return NaN;
  return Date.parse(`${year.padStart(4, "0")}-${month}-${day}T${hour}:${minute}:00Z`);
}

function londonInstant(wallMinute: number): number {
  const before = wallMinute - dayMilliseconds;
  const after = wallMinute + dayMilliseconds;
  const first = wallMinute - (londonWallMinute(before) - before);
  const second = wallMinute - (londonWallMinute(after) - after);
  let earlier = Math.min(first, second);
  let later = Math.max(first, second);
  if (earlier === later || londonWallMinute(earlier) === wallMinute) return earlier;
  if (londonWallMinute(later) === wallMinute) return later;
  while (later - earlier > minuteMilliseconds) {
    const mid = earlier + Math.floor((later - earlier) / (2 * minuteMilliseconds)) * minuteMilliseconds;
    if (londonWallMinute(mid) < wallMinute) earlier = mid;
    else later = mid;
  }
  return later;
}

function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith("0000")) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function findWorkingDate(
  startingDate: string,
  daysToAdvance: number,
  calendar: WorkingDayCalendar,
  calendarName: "warehouse" | "delivery",
): CommerceResult<string, DispatchError> {
  const { workingWeekdays, dateRange } = calendar;
  const closedDates = new Set([...calendar.bankHolidays, ...calendar.closures]);
  if (
    workingWeekdays.length === 0 ||
    workingWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    [...closedDates].some((date) => !isCalendarDate(date)) ||
    !dateRange || !isCalendarDate(dateRange.from) || !isCalendarDate(dateRange.through) ||
    dateRange.from > dateRange.through
  ) {
    return { ok: false, error: { code: "invalid_calendar", calendar: calendarName } };
  }
  if (startingDate < dateRange.from || startingDate > dateRange.through) {
    return { ok: false, error: { code: "calendar_out_of_range", calendar: calendarName } };
  }

  let timestamp = Date.parse(`${startingDate}T00:00:00Z`);
  if (daysToAdvance > 0) timestamp += dayMilliseconds;
  let remainingDays = Math.max(1, daysToAdvance);
  while (Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    const key = date.toISOString().slice(0, 10);
    if (key.startsWith("+") || key > dateRange.through) break;
    if (workingWeekdays.some((day) => day === date.getUTCDay()) && !closedDates.has(key)) {
      if (--remainingDays === 0) return { ok: true, value: key };
    }
    timestamp += dayMilliseconds;
  }
  return { ok: false, error: { code: "calendar_out_of_range", calendar: calendarName } };
}

export function calculateDispatchDetails({
  authorisedAt,
  deliveryQuote,
  warehouseCalendar = ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027,
  deliveryCalendar = ENGLAND_WALES_BANK_HOLIDAY_CALENDAR_2026_2027,
  cutoffMinutes = 15 * 60 + 30,
}: DispatchInput): CommerceResult<DispatchPromise & { dispatchTiming: DispatchTiming }, DispatchError> {
  if (typeof authorisedAt !== "string") return { ok: false, error: { code: "invalid_authorised_at" } };
  const instantParts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(authorisedAt);
  const instant = new Date(authorisedAt);
  if (
    !instantParts || !Number.isFinite(instant.getTime()) ||
    instant.toISOString() !== `${instantParts[1]}.${(instantParts[2] ?? "").padEnd(3, "0")}Z` ||
    authorisedAt.startsWith("0000")
  ) {
    return { ok: false, error: { code: "invalid_authorised_at" } };
  }
  if (deliveryQuote != null && !isValidDeliveryQuote(deliveryQuote)) {
    return { ok: false, error: { code: "invalid_delivery_quote" } };
  }
  if (!Number.isInteger(cutoffMinutes) || cutoffMinutes < 0 || cutoffMinutes > 1439) {
    return { ok: false, error: { code: "invalid_calendar", calendar: "warehouse" } };
  }

  const checkedAt = instant.getTime();
  const wallMinute = londonWallMinute(checkedAt);
  if (!Number.isFinite(wallMinute)) return { ok: false, error: { code: "invalid_authorised_at" } };
  const midnight = Math.floor(wallMinute / dayMilliseconds) * dayMilliseconds;
  const londonDate = new Date(midnight).toISOString().slice(0, 10);
  const cutoff = londonInstant(midnight + cutoffMinutes * minuteMilliseconds);
  const dispatch = findWorkingDate(londonDate, checkedAt >= cutoff ? 1 : 0, warehouseCalendar, "warehouse");
  if (!dispatch.ok) return dispatch;

  const cutoffAt = dispatch.value === londonDate ? cutoff : null;
  const dispatchTiming = { checkedAt, cutoffAt, validUntil: cutoffAt ?? londonInstant(midnight + dayMilliseconds) };
  if (!deliveryQuote) return { ok: true, value: { dispatchDate: dispatch.value, estimatedDeliveryDate: null, dispatchTiming } };
  const delivery = findWorkingDate(dispatch.value, deliveryQuote.workingDays, deliveryCalendar, "delivery");
  if (!delivery.ok) return delivery;

  return { ok: true, value: { dispatchDate: dispatch.value, estimatedDeliveryDate: delivery.value, dispatchTiming } };
}

export function calculateDispatchPromise(input: DispatchInput): CommerceResult<DispatchPromise, DispatchError> {
  const result = calculateDispatchDetails(input);
  if (!result.ok) return result;
  const { dispatchDate, estimatedDeliveryDate } = result.value;
  return { ok: true, value: { dispatchDate, estimatedDeliveryDate } };
}
