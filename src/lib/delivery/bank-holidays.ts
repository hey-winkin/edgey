import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import snapshot from "./bank-holidays.snapshot.json";

export const BANK_HOLIDAYS_URL = "https://www.gov.uk/bank-holidays";
const bundledDates = new Set(snapshot.events.map(({ date }) => date));

const feedSchema = z.object({
  "england-and-wales": z.object({
    division: z.literal("england-and-wales"),
    events: z.array(z.object({
      date: z.iso.date().refine((date) => !date.startsWith("0000")),
      title: z.string().trim().min(1),
      notes: z.string(),
    })).nonempty(),
  }),
});

async function readGovUkBankHolidays() {
  const response = await fetch(snapshot.source, { cache: "no-store", signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error("Could not load GOV.UK bank holidays.");
  const feed = feedSchema.parse(await response.json());
  const liveEvents = feed["england-and-wales"].events;
  const years = Object.groupBy(liveEvents, ({ date }) => date.slice(0, 4));
  const completeYears = new Set(Object.entries(years).filter(([year, events]) => {
    const dates = [...new Set(events?.map(({ date }) => date))];
    return dates.length >= 8 && dates.some((date) => date.startsWith(year + "-01-"))
      && dates.some((date) => date.startsWith(year + "-12-"));
  }).map(([year]) => year));
  if (!completeYears.size) throw new Error("GOV.UK did not publish a complete year of bank holidays.");

  const liveDates = new Set(liveEvents.map(({ date }) => date));
  const savedEvents = snapshot.events.filter(({ date }) => !completeYears.has(date.slice(0, 4)) && !liveDates.has(date));
  return {
    events: [...liveEvents, ...savedEvents].sort((a, b) => a.date.localeCompare(b.date)),
    refreshedAt: new Date().toISOString(),
    source: "gov.uk" as const,
    supplementedDates: savedEvents.map(({ date }) => date),
  };
}

const savedCalendar = {
  events: snapshot.events, refreshedAt: snapshot.refreshedAt, source: "snapshot" as const, supplementedDates: [],
};

const readCachedCalendar = unstable_cache(async () => {
  try {
    return await readGovUkBankHolidays();
  } catch {
    return savedCalendar;
  }
}, ["gov-uk-england-and-wales-calendar"], { revalidate: 900 });

export async function readBankHolidays() {
  try {
    return await readCachedCalendar();
  } catch {
    return savedCalendar;
  }
}

export async function readBankHolidayDates() {
  const { events } = await readBankHolidays();
  return [...new Set(events.map(({ date }) => date))];
}

export function otherClosureDates(
  calendar: { bank_holidays: string[]; closures: string[] },
  officialHolidays: ReadonlySet<string>,
) {
  return [...new Set([
    ...calendar.closures,
    ...calendar.bank_holidays.filter((date) => !officialHolidays.has(date) || !bundledDates.has(date)),
  ])].sort();
}
