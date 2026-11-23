"use client";

import { useActionState } from "react";
import type { AdminResult } from "@/app/admin/form";
import styles from "../deliveries.module.css";

export function DeliveryCostForm({ action, sku }: {
  action: (previous: AdminResult | null, form: FormData) => Promise<AdminResult>;
  sku: string;
}) {
  const [result, submit, pending] = useActionState(action, null);
  return (
    <form className={styles.costForm} action={submit} aria-busy={pending}>
      <label className="admin-field">
        <span>Unit cost (£)<span className="sr"> for {sku}</span></span>
        <input type="text" name="unitCost" inputMode="decimal" autoComplete="off" required maxLength={20} />
      </label>
      <button className="admin-secondary" disabled={pending}>
        {pending ? "Saving…" : "Save unit cost"}<span className="sr"> for {sku}</span>
      </button>
      {result && <p role={result.ok ? "status" : "alert"}>{result.message}</p>}
    </form>
  );
}
