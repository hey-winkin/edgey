"use client";

import { TriangleAlert } from "lucide-react";
import { createContext, useActionState, useContext, useId, type ReactNode } from "react";

export type AdminResult = { message: string; ok: boolean; field?: string };
const ResultContext = createContext<AdminResult | null>(null);

export function useAdminFieldError(name: string) {
  const result = useContext(ResultContext);
  return !result?.ok && result?.field === name ? result.message : undefined;
}

export function AdminForm({ action, children, submit, confirmation, preserveOnError }: {
  action: (previous: AdminResult | null, data: FormData) => Promise<AdminResult>;
  children?: ReactNode;
  submit: string;
  confirmation?: { description: string; label: string; name?: string; submit?: string };
  preserveOnError?: boolean;
}) {
  const [result, submitAction, pending] = useActionState(action, null);
  const descriptionId = useId();
  const submitLabel = confirmation
    ? confirmation.submit ?? `Confirm ${submit[0]?.toLowerCase() ?? ""}${submit.slice(1)}`
    : submit;
  const form = (
    <form className="admin-form" action={submitAction} aria-busy={pending}
      onReset={preserveOnError && result?.ok === false ? (event) => event.preventDefault() : undefined}>
      {confirmation && <p id={descriptionId}>{confirmation.description}</p>}
      <ResultContext.Provider value={result}>{children}</ResultContext.Provider>
      {confirmation && (
        <label className="admin-check">
          <input type="checkbox" name={confirmation.name ?? "confirm"} value="yes" aria-describedby={descriptionId} required />
          {confirmation.label}
        </label>
      )}
      <div>
        <button type="submit" className={confirmation ? "admin-danger" : "primary"} disabled={pending}>
          {pending ? (confirmation ? "Submitting…" : "Saving…") : submitLabel}
        </button>
      </div>
      {result && !result.field && (
        <p className="admin-notice" role={result.ok ? "status" : "alert"}>{result.message}</p>
      )}
    </form>
  );
  if (!confirmation) return form;
  return (
    <details className="admin-confirmation" open={result ? true : undefined}>
      <summary className="admin-danger"><TriangleAlert aria-hidden="true" size={16} />{submit}</summary>
      {form}
    </details>
  );
}
