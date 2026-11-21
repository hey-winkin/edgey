"use client";

import { useEffect } from "react";
import { useSelection } from "@/components/selection-provider";
import type { LineRequest } from "@/lib/commerce";
import { clearConfirmedActivePayment } from "@/lib/payments/checkout-attempt-client";
import { clearConfirmedCheckoutSelection } from "./selection-handoff";

export function ClearPaidSelection({ scope, lines }: { scope: string; lines: LineRequest[] }) {
  const { hydrated, clearIf } = useSelection();

  useEffect(() => {
    if (hydrated) void clearConfirmedCheckoutSelection(scope, lines, clearIf);
  }, [clearIf, hydrated, lines, scope]);
  useEffect(() => {
    void clearConfirmedActivePayment(scope);
  }, [scope]);

  return null;
}
