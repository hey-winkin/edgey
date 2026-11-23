"use client";

import { createContext, Fragment, useActionState, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminResult } from "@/app/admin/form";
import styles from "./editor.module.css";

const EditorContext = createContext<{
  costInput: string | undefined;
  setCostInput: (value: string | undefined) => void;
  setDirty: (id: string, dirty: boolean) => void;
  sellingRevision: number;
  sellingDirty: boolean;
  refreshSelling: () => void;
} | null>(null);

export function EditorWorkspace({ children, sellingVersion }: { children: ReactNode; sellingVersion?: string }) {
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({});
  const [costInput, setCostInput] = useState<string>();
  const [sellingSnapshot, setSellingSnapshot] = useState(() => ({ version: sellingVersion, revision: 0 }));
  const sellingDirty = Boolean(dirtyForms[sellingFormId]);
  const refreshSelling = useCallback(() => {
    setSellingSnapshot((previous) => ({ version: sellingVersion, revision: previous.revision + 1 }));
  }, [sellingVersion]);
  if (!sellingDirty && sellingVersion !== sellingSnapshot.version) {
    setSellingSnapshot({ version: sellingVersion, revision: sellingSnapshot.revision + 1 });
  }
  const setDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyForms((forms) => Boolean(forms[id]) === dirty ? forms : { ...forms, [id]: dirty });
  }, []);
  const dirty = Object.values(dirtyForms).some(Boolean);

  useEffect(() => {
    if (!dirty) return;
    function confirmUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function confirmNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.download || (link.target && link.target !== "_self")) return;
      if (link.origin === location.origin && link.pathname === location.pathname && link.search === location.search && link.hash) return;
      if (!window.confirm("Leave this variant? Your unsaved changes will be lost.")) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        window.removeEventListener("beforeunload", confirmUnload);
      }
    }
    window.addEventListener("beforeunload", confirmUnload);
    document.addEventListener("click", confirmNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", confirmUnload);
      document.removeEventListener("click", confirmNavigation, true);
    };
  }, [dirty]);

  return <EditorContext.Provider value={{ costInput, setCostInput, setDirty, sellingRevision: sellingSnapshot.revision, sellingDirty, refreshSelling }}>
    {children}
  </EditorContext.Provider>;
}

export function useEditorSnapshot() {
  return useContext(EditorContext)!;
}

export function SellingDraftNotice({ canRetire = false }: { canRetire?: boolean }) {
  const { sellingDirty } = useEditorSnapshot();
  if (!sellingDirty) return null;
  return <p className="admin-notice">
    These actions use saved selling data only. {canRetire && "Retiring the SKU discards its unsaved selling changes."}
  </p>;
}

export function SellingFields({ children }: { children: ReactNode }) {
  const { sellingRevision } = useEditorSnapshot();
  return <SellingFieldsSnapshot key={sellingRevision}>{children}</SellingFieldsSnapshot>;
}

function SellingFieldsSnapshot({ children }: { children: ReactNode }) {
  const [snapshot] = useState(() => children);
  return snapshot;
}

export const sellingFormId = "variant-selling-data";
const landedField = "landed_unit_pence";

function currentInputs(form: HTMLFormElement) {
  return JSON.stringify(Array.from(new FormData(form)).filter(([name]) =>
    !name.startsWith("$ACTION_") && !["version", "familyVersion", "operation"].includes(name),
  ));
}

export function EditorForm({ id, action, children, submit, selling = false, receiptCorrection = false }: {
  id: string;
  action: (previous: AdminResult | null, data: FormData) => Promise<AdminResult>;
  children: ReactNode;
  submit: string;
  selling?: boolean;
  receiptCorrection?: boolean;
}) {
  const { setCostInput, setDirty, refreshSelling, sellingRevision } = useEditorSnapshot();
  const [snapshot, setSnapshot] = useState(() => ({ action, children, submit, receiptCorrection, revision: selling ? sellingRevision : 0 }));
  if (selling && snapshot.revision !== sellingRevision) {
    setSnapshot({ action, children, submit, receiptCorrection, revision: sellingRevision });
  }
  const [result, formAction, pending] = useActionState(snapshot.action, null);
  const [dirty, setLocalDirty] = useState(false);
  const [requiresReload, setRequiresReload] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const saved = useRef("");
  const submitted = useRef<string | null>(null);

  const updateDirty = useCallback((changed: boolean) => {
    setLocalDirty(changed);
    setDirty(id, changed);
  }, [id, setDirty]);

  useEffect(() => {
    const form = formRef.current!;
    saved.current = currentInputs(form);
    function onInput(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)
        || target.form !== form) return;
      updateDirty(currentInputs(form) !== saved.current || target.validity.badInput);
      if (target.name === landedField) setCostInput(target.value);
    }
    document.addEventListener("input", onInput);
    return () => {
      document.removeEventListener("input", onInput);
      setDirty(id, false);
    };
  }, [id, setCostInput, setDirty, snapshot.revision, updateDirty]);

  useEffect(() => {
    if (!result || pending || submitted.current === null || !formRef.current) return;
    const form = formRef.current;
    const savedSubmission = submitted.current;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      submitted.current = null;
      if (!result.ok) return;
      saved.current = savedSubmission;
      if (currentInputs(form) !== saved.current) {
        updateDirty(true);
        setRequiresReload(true);
        return;
      }
      updateDirty(false);
      if (selling) refreshSelling();
      else {
        setSnapshot((previous) => ({ action, children, submit, receiptCorrection, revision: previous.revision + 1 }));
        setCostInput(undefined);
      }
    });
    return () => { cancelled = true; };
  }, [action, children, pending, receiptCorrection, refreshSelling, result, selling, setCostInput, submit, updateDirty]);

  const form = (
    <form ref={formRef} id={id} className={selling ? styles.saveBar : "admin-form"} action={formAction} aria-busy={pending}
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => { submitted.current = currentInputs(event.currentTarget); }}>
      <Fragment key={snapshot.revision}>{snapshot.children}</Fragment>
      <div className={styles.saveControls}>
        <button className="primary" disabled={pending || requiresReload}>{pending ? "Saving…" : snapshot.submit}</button>
        <span className={styles.saveState} role="status">
          {dirty ? selling ? "Unsaved selling changes" : "Unsaved cost changes" : ""}
        </span>
      </div>
      {result && <p className={styles.saveResult} role={result.ok ? "status" : "alert"}>{result.message}</p>}
      {requiresReload && <p className={styles.saveResult} role="alert">
        Changes made while saving weren’t saved. Copy those changes, then reload the page and apply them to the latest record.
      </p>}
    </form>
  );
  if (selling) return form;
  return (
    <details className="admin-panel" open={!snapshot.receiptCorrection || result ? true : undefined}>
      <summary>{snapshot.receiptCorrection ? "Correct latest receipt cost" : "Edit cost estimate"}</summary>
      {form}
    </details>
  );
}
