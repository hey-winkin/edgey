"use client";

import { createHashScope, clearConfirmedCheckoutSelection } from "../../success/selection-handoff";
import { clearNet30Attempt, net30SelectionScope } from "../../net30-attempt";
import { useEffect } from "react";
import { useSelection } from "@/components/selection-provider";
import type { LineRequest } from "@/lib/commerce";

export function ClearInvoicedSelection({ orderId, lines }: { orderId: string; lines: LineRequest[] }) {
  const { hydrated, clearIf } = useSelection();

  useEffect(() => {
    if (!hydrated) return;
    void (async () => {
      const scope = await createHashScope(net30SelectionScope(orderId));
      await clearConfirmedCheckoutSelection(scope, lines, clearIf);
      await clearNet30Attempt({ orderId });
    })().catch(() => {});
  }, [clearIf, hydrated, lines, orderId]);

  return null;
}
