"use client";

import { useEffect, useState } from "react";
import type { QuoteResult } from "@/lib/checkout/types";

const dispatchDay = new Intl.DateTimeFormat("en-GB", {
  weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
});
const londonTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London",
});
const minute = 60_000;

export type QuoteClock = { receivedAt: number; receivedTick: number; roundTrip: number };

export function startQuoteClock() {
  const startedAt = Date.now();
  const startedTick = performance.now();
  return (): QuoteClock => {
    const receivedAt = Date.now();
    const receivedTick = performance.now();
    return { receivedAt, receivedTick, roundTrip: Math.max(receivedAt - startedAt, receivedTick - startedTick) };
  };
}

type DispatchCopy = { date: string; text: string; announcement: string };

export function useDispatchNotice(quote: QuoteResult | undefined, clock: QuoteClock | undefined, onExpire: () => void): DispatchCopy | null {
  const { dispatchDate, dispatchTiming } = quote?.status === "ok" ? quote : {};
  const [observation, setObservation] = useState<{ clock: QuoteClock; remaining: number }>();

  useEffect(() => {
    if (!clock || !dispatchTiming) return;
    const { checkedAt, cutoffAt, validUntil } = dispatchTiming;
    let timer: number | undefined;
    let expired = false;
    function update() {
      window.clearTimeout(timer);
      if (!clock || expired || document.visibilityState === "hidden") return;
      const elapsed = Math.max(Date.now() - clock.receivedAt, performance.now() - clock.receivedTick);
      const untilRefresh = validUntil - checkedAt - elapsed;
      const remaining = untilRefresh - clock.roundTrip;
      setObservation({ clock, remaining });
      if (untilRefresh <= 0) {
        expired = true;
        onExpire();
        return;
      }
      const wakeIn = remaining <= 0 ? untilRefresh
        : cutoffAt === null ? remaining
        : Math.min(remaining, remaining % minute + 1);
      timer = window.setTimeout(update, Math.max(1, wakeIn));
    }
    timer = window.setTimeout(update, 0);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pageshow", update);
    window.addEventListener("focus", update);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pageshow", update);
      window.removeEventListener("focus", update);
    };
  }, [dispatchTiming, clock, onExpire]);

  if (!dispatchDate || !dispatchTiming || !observation || observation.clock !== clock || observation.remaining <= 0) return null;
  const dateLabel = dispatchDay.format(new Date(dispatchDate + "T00:00:00Z"));
  if (dispatchTiming.cutoffAt === null) {
    const text = "Dispatches " + dateLabel;
    return { date: dispatchDate, text, announcement: text };
  }
  const minutes = Math.floor(observation.remaining / minute);
  const hours = Math.floor(minutes / 60);
  const duration = [hours && `${hours} h`, minutes % 60 && `${minutes % 60} min`].filter(Boolean).join(" ");
  return {
    date: dispatchDate,
    text: minutes > 0 ? `Order within ${duration} for dispatch today` : "Less than 1 min to order for dispatch today",
    announcement: `Order before ${londonTime.format(dispatchTiming.cutoffAt)} UK time for dispatch today, ${dateLabel}.`,
  };
}

export function DispatchNotice({ copy }: { copy: DispatchCopy | null }) {
  const announcement = copy?.announcement;
  const [status, setStatus] = useState<{ current?: string; last?: string; live?: string }>({});
  if (announcement !== status.current) {
    setStatus({
      current: announcement,
      last: announcement ?? status.last,
      live: announcement === status.last ? undefined : announcement,
    });
  }
  return (
    <>
      <div className="sr" role="status">{status.live}</div>
      {copy && (
        <p className="fine">
          {!status.live && <span className="sr">{announcement}</span>}
          <time dateTime={copy.date} aria-hidden="true">{copy.text}</time>
        </p>
      )}
    </>
  );
}
