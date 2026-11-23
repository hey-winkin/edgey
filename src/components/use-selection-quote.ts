"use client";

import { useCallback, useEffect, useState } from "react";
import { quoteSelection } from "@/app/(shop)/checkout/actions";
import type { QuoteResult } from "@/lib/checkout/types";
import type { LineRequest } from "@/lib/commerce";
import { startQuoteClock, type QuoteClock } from "./dispatch-notice";

export function useSelectionQuote(
  lines: LineRequest[],
  enabled: boolean,
  { postcode, includeProductNames = true }: { postcode?: string; includeProductNames?: boolean } = {},
) {
  const [refresh, setRefresh] = useState(0);
  const request = JSON.stringify({ lines, postcode });
  const [settled, setSettled] = useState<{ request: string; refresh: number; quote: QuoteResult; clock: QuoteClock }>();
  const retry = useCallback(() => setRefresh((value) => value + 1), []);
  const current = settled?.request === request && settled.refresh === refresh;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const { lines, postcode } = JSON.parse(request) as { lines: LineRequest[]; postcode?: string };
      const stopClock = startQuoteClock();
      let quote: QuoteResult;
      try {
        quote = await quoteSelection(lines, postcode, includeProductNames);
      } catch {
        quote = { status: "error", message: "We couldn’t check these prices. Try again." };
      }
      if (!cancelled) setSettled({ request, refresh, quote, clock: stopClock() });
    }, 140);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [request, enabled, refresh, includeProductNames]);

  return {
    quote: current && enabled ? settled.quote : undefined,
    clock: current && enabled ? settled.clock : undefined,
    previousQuote: settled?.quote,
    pending: enabled && !current,
    retry,
  };
}
