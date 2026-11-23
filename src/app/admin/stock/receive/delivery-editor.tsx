"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AdminField } from "@/app/admin/ui";
import {
  DELIVERY_QUANTITY_MAX, MAX_DELIVERY_CODE_LENGTH, MAX_DELIVERY_IMPORT_BYTES, MAX_DELIVERY_ROWS,
} from "@/lib/admin/deliveries";
import {
  deliveryCodeError, deliveryHeaderErrors, editDeliveryRows, groupDeliveryMatches, readDeliveryDraft, readDeliveryRows,
  type DeliveryDraft, type EditorRow, type EditorState,
} from "@/lib/admin/delivery-editor-state";
import { formatGbp } from "@/lib/commerce/money";
import { lookupDeliveryCodes } from "./actions";
import { runDeliveryEditor, submitDeliveryEditor } from "./editor-action";
import styles from "./delivery-editor.module.css";

const quantityMax = DELIVERY_QUANTITY_MAX.toLocaleString("en-GB");
const displayDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });
const number = new Intl.NumberFormat("en-GB");

function rowId(row: EditorRow, field: string) {
  return `receipt-${row.id}-${field}`;
}

export function DeliveryEditor({ initial, showCosts, today }: { initial: EditorState; showCosts: boolean; today: string }) {
  const router = useRouter();
  const [nativeState, action, nativePending] = useActionState(submitDeliveryEditor, initial, "/admin/stock/receive");
  const [enhanced, setEnhanced] = useState<{ base: EditorState; state: EditorState }>();
  const state = enhanced?.base === nativeState ? enhanced.state : nativeState;
  const [live, setLive] = useState<{ state: EditorState; draft: DeliveryDraft }>();
  const draft = live?.state === state ? live.draft : state.draft;
  const [liveChecks, setLiveChecks] = useState<ReturnType<typeof groupDeliveryMatches>>(() => new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef(false);
  const pending = useRef(new Set<string>());
  const importing = useRef<HTMLDetailsElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const { review } = state;
  const checkedCodes = state.checkedCodes ?? state.matches.map(({ inputCode }) => inputCode);
  const checks = new Map([...liveChecks, ...groupDeliveryMatches(checkedCodes, state.matches)]);
  const ledgerRows = readDeliveryRows(draft.rows, checks, showCosts);
  const entered = ledgerRows.filter(({ active }) => active).length;
  const ready = ledgerRows.filter((line) => line.ready);
  const units = ready.reduce((total, { quantity }) => total + (quantity ?? 0), 0);
  const reviewedUnits = review?.lines.reduce((total, line) => total + line.quantity, 0) ?? 0;
  const previousDelivery = review?.previous.ok ? review.previous.record : null;
  const historyError = review && !review.previous.ok ? review.previous.error : null;
  const showErrors = Boolean(state.error && state.errorAt !== "receipt-import-error");
  const headerErrors = showErrors ? deliveryHeaderErrors(draft) : undefined;
  const importError = state.errorAt === "receipt-import-error" ? state.error : undefined;
  const waiting = busy !== null || nativePending;
  const lineClass = `${styles.line} ${showCosts ? styles.withCost : ""}`;

  useEffect(() => {
    if (state.errorAt) document.getElementById(state.errorAt)?.focus();
  }, [state]);

  const warnOnUnload = busy === "commit" || Boolean(state.retryOnly);
  useEffect(() => {
    if (!warnOnUnload) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [warnOnUnload]);

  const checkCodes = useCallback(async (codes: string[]) => {
    const fresh = [...new Set(codes)].filter((code) => !pending.current.has(code));
    if (!fresh.length) return;
    fresh.forEach((code) => pending.current.add(code));
    try {
      const result = await lookupDeliveryCodes(fresh)
        .catch(() => ({ ok: false as const, error: "Could not check blade codes. Try reviewing again." }));
      const next = result.ok ? groupDeliveryMatches(fresh, result.matches) : fresh.map((code) => [code, { error: result.error }] as const);
      setLiveChecks((previous) => new Map([...previous, ...next]));
    } finally {
      fresh.forEach((code) => pending.current.delete(code));
    }
  }, []);

  const attachForm = useCallback((form: HTMLFormElement | null) => {
    if (!form || state.review) return;
    const current = readDeliveryDraft(new FormData(form), showCosts);
    setLive({ state, draft: current });
    const renderedCodes = new Map(state.draft.rows.map(({ id, code }) => [id, code.trim()]));
    const newCodes = current.rows.flatMap(({ id, code }) => {
      const value = code.trim();
      return value !== renderedCodes.get(id) && !deliveryCodeError(value) ? [value] : [];
    });
    if (newCodes.length) void checkCodes(newCodes);
  }, [checkCodes, showCosts, state]);

  function syncDraft(event: FormEvent<HTMLFormElement>) {
    setLive({ state, draft: readDeliveryDraft(new FormData(event.currentTarget), showCosts) });
  }

  function advance(event: KeyboardEvent<HTMLInputElement>, row: EditorRow, index: number, field: "code" | "quantity" | "unitCost") {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const next = draft.rows[index + 1];
    if (field === "code") {
      document.getElementById(rowId(row, "quantity"))?.focus();
    } else if (field === "quantity" && showCosts) {
      document.getElementById(rowId(row, "cost"))?.focus();
    } else if (next) {
      document.getElementById(rowId(next, "code"))?.focus();
    } else if (row.code.trim() || row.quantity.trim() || row.unitCost.trim() || event.currentTarget.value.trim()) {
      const button = addButton.current;
      if (button && !button.disabled) button.form?.requestSubmit(button);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current || nativePending) return;

    const form = event.currentTarget;
    const formData = new FormData(form, (event.nativeEvent as SubmitEvent).submitter);
    const intent = formData.get("intent");
    if (typeof intent !== "string") return;
    const submitted = review ? state.draft : readDeliveryDraft(formData, showCosts);
    const importOpen = importing.current?.open ?? state.importOpen;
    const edit = review ? null : editDeliveryRows(submitted, intent);
    if (edit) {
      setEnhanced({ base: nativeState, state: { matches: state.matches, checkedCodes: state.checkedCodes, importOpen, ...edit } });
      return;
    }
    if (intent === "import") {
      const file = formData.get("file");
      if ((file instanceof File && file.size > MAX_DELIVERY_IMPORT_BYTES) ||
          new TextEncoder().encode(String(formData.get("paste") ?? "")).byteLength > MAX_DELIVERY_IMPORT_BYTES) {
        setEnhanced({ base: nativeState, state: {
          ...state, draft: submitted, error: "Use a file or pasted table no larger than 128 KB.", errorAt: "receipt-import-error", importOpen: true,
        } });
        return;
      }
    } else {
      formData.delete("file");
    }

    operation.current = true;
    setBusy(intent);
    try {
      const next = await runDeliveryEditor(state, formData);
      if ("recordedId" in next) {
        router.replace(`/admin/stock/deliveries/${next.recordedId}`);
        return;
      }
      if (intent === "import" && !next.error) {
        const paste = form.elements.namedItem("paste");
        const file = form.elements.namedItem("file");
        if (paste instanceof HTMLTextAreaElement) paste.value = "";
        if (file instanceof HTMLInputElement) file.value = "";
        if (importing.current) importing.current.open = false;
      }
      setEnhanced({ base: nativeState, state: { ...next, importOpen: next.importOpen ?? (intent === "import" ? false : importOpen) } });
    } catch {
      setEnhanced({ base: nativeState, state: {
        ...state,
        draft: submitted,
        error: intent === "commit"
          ? "Could not confirm the receipt. Retry this review or check delivery history before starting again."
          : intent === "import" ? "Could not import the table. Try again." : "Could not update the delivery. Try again.",
        errorAt: intent === "commit" ? "receipt-commit-error" : intent === "import" ? "receipt-import-error" : "receipt-review-error",
        retryOnly: intent === "commit" || state.retryOnly,
        importOpen: intent === "import" || importOpen,
      } });
    }
    operation.current = false;
    setBusy(null);
  }

  return (
    <form className={styles.editor} id="receipt-editor" ref={attachForm} action={action} onSubmit={submit}
      onInput={syncDraft} noValidate aria-busy={waiting || undefined}>
      <input type="hidden" name="deliveryId" value={state.draft.id} />
      <ol className={styles.steps} role="list" aria-label="Receive delivery steps">
        <li aria-current={!review ? "step" : undefined}><span aria-hidden="true">01</span> Enter delivery</li>
        <li aria-current={review ? "step" : undefined}><span aria-hidden="true">02</span> Review and receive</li>
      </ol>
      {review ? (
        <section className={styles.sheet} aria-labelledby="receipt-review-heading">
          <div className={styles.sheetHeader}>
            <h2 id="receipt-review-heading" tabIndex={-1}>Review delivery</h2>
            <p>Check each matched blade name and SKU against the packet, then receive stock to add the listed units.</p>
          </div>
          <dl className={styles.reviewDetails}>
            <div><dt>Delivery reference</dt><dd className="admin-mono">{review.input.reference}</dd></div>
            <div><dt>Date received</dt><dd><time dateTime={review.input.receivedOn}>{displayDate.format(new Date(review.input.receivedOn))}</time></dd></div>
            {review.input.note && <div className={styles.note}><dt>Delivery note</dt><dd className="admin-preserve-lines">{review.input.note}</dd></div>}
          </dl>
          <div className={`${styles.columns} ${styles.reviewLine} ${lineClass}`} aria-hidden="true">
            <span>No.</span><span>Matched SKU</span><span>Blade name</span><span>Quantity</span>{showCosts && <span>Unit cost</span>}
          </div>
          <ol className={styles.lines} role="list" aria-label="Reviewed delivery lines">
            {review.lines.map(({ variantId, quantity, unitCostPence, sku, bladeName }, index) => (
              <li className={`${lineClass} ${styles.reviewLine}`} key={variantId}>
                <span className={styles.lineNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span className={`${styles.code} admin-mono`}>{sku}</span>
                <span className={styles.blade}>{bladeName}</span>
                <span className={styles.quantity}><span className="sr">Quantity: </span><span className="admin-mono">{number.format(quantity)}</span></span>
                {showCosts && <span className={styles.cost}><span className="sr">Unit cost: </span><span className="admin-mono">{unitCostPence === null ? "Not recorded" : formatGbp(unitCostPence)}</span></span>}
              </li>
            ))}
          </ol>
          <div className={styles.sheetFooter}>
            <p><strong>{review.lines.length}</strong> {review.lines.length === 1 ? "line" : "lines"} <span className="admin-muted">/</span> <strong>{number.format(reviewedUnits)}</strong> {reviewedUnits === 1 ? "unit" : "units"} to receive</p>
            {(previousDelivery || historyError) && (
              <div className={styles.errorBlock}>
                <p>{previousDelivery
                  ? `This reference was already used for a delivery dated ${displayDate.format(new Date(previousDelivery.receivedOn))}. Check that this is a separate delivery before receiving stock.`
                  : historyError}</p>
                <a className="textlink" target="_blank" rel="noopener" href={previousDelivery
                  ? `/admin/stock/deliveries/${previousDelivery.id}` : "/admin/stock/deliveries"}>
                  {previousDelivery ? "Open previous delivery" : "Check delivery history"} (opens in a new tab)
                </a>
              </div>
            )}
            {state.error && busy !== "commit" && (
              <div className={styles.errorBlock} id="receipt-commit-error" tabIndex={-1} role="alert">
                <p>{state.error}</p>
                {state.retryOnly && (
                  <a className="textlink" href="/admin/stock/deliveries" target="_blank" rel="noopener">
                    Check delivery history (opens in a new tab)
                  </a>
                )}
              </div>
            )}
            <div className={styles.actions}>
              {!state.retryOnly && <button className="secondary" type="submit" name="intent" value="back" disabled={waiting}>Back to edit</button>}
              <button className="primary" type="submit" name="intent" value="commit" disabled={waiting}>
                {busy === "commit" ? "Receiving stock…" : state.error ? "Retry receiving stock" : "Receive stock"}
              </button>
            </div>
            {busy === "commit" && <p className="sr" role="status">Receiving stock. Please wait.</p>}
          </div>
        </section>
      ) : (
        <fieldset className={styles.editing} disabled={waiting}>
          <legend className="sr">Enter delivery</legend>
          <button type="submit" name="intent" value="review" hidden>Review delivery</button>
          <section className={styles.sheet} aria-labelledby="receipt-details-heading">
            <div className={styles.sheetHeader}>
              <h2 id="receipt-details-heading">Delivery details</h2>
              <p>Use the reference from your delivery paperwork.</p>
            </div>
            <div className={styles.metadata}>
              <div>
                <AdminField label="Delivery reference">
                  <input id="receipt-reference" name="reference" defaultValue={state.draft.reference} maxLength={MAX_DELIVERY_CODE_LENGTH}
                    required autoComplete="off" aria-invalid={Boolean(headerErrors?.reference)}
                    aria-describedby={headerErrors?.reference ? "receipt-reference-error" : undefined} />
                </AdminField>
                {headerErrors?.reference && <p className={styles.error} id="receipt-reference-error">{headerErrors.reference}</p>}
              </div>
              <div>
                <AdminField label="Date received">
                  <input id="receipt-date" name="receivedOn" type="date" required max={today} defaultValue={state.draft.receivedOn}
                    aria-invalid={Boolean(headerErrors?.date)} aria-describedby={headerErrors?.date ? "receipt-date-error" : undefined} />
                </AdminField>
                {headerErrors?.date && <p className={styles.error} id="receipt-date-error">{headerErrors.date}</p>}
              </div>
              <div className={styles.note}>
                <AdminField label="Delivery note (optional)">
                  <textarea id="receipt-note" name="note" rows={1} maxLength={500} defaultValue={state.draft.note}
                    aria-invalid={Boolean(headerErrors?.note)} aria-describedby={headerErrors?.note ? "receipt-note-error" : undefined} />
                </AdminField>
                {headerErrors?.note && <p className={styles.error} id="receipt-note-error">{headerErrors.note}</p>}
              </div>
            </div>
          </section>

          <section className={styles.sheet} aria-labelledby="receipt-lines-heading">
            <div className={`${styles.sheetHeader} ${styles.ledgerHeader}`}>
              <div>
                <h2 id="receipt-lines-heading">Delivery lines</h2>
                <p>Enter a SKU or maker code. {live?.state === state && "Press Enter to move to the next field or line."}</p>
                {showCosts && <p>Unit cost is optional. Enter landed cost in pounds per blade.</p>}
              </div>
              <dl className={styles.tally}>
                <div><dt>Lines ready</dt><dd>{ready.length}<span> / {entered}</span></dd></div>
                <div><dt>Units ready</dt><dd>{number.format(units)}</dd></div>
              </dl>
            </div>

            <details className={styles.import} ref={importing} open={state.importOpen} suppressHydrationWarning>
              <summary>Import lines</summary>
              <div className={styles.importForm}>
                <p id="receipt-import-help">Paste spreadsheet rows or choose a CSV file. Use columns in this order: code, quantity{showCosts ? ", optional unit cost" : ""}. Up to 200 lines and 128 KB.</p>
                <div className={styles.importFields}>
                  <AdminField label="Spreadsheet rows">
                    <textarea id="receipt-paste" name="paste" rows={4} maxLength={MAX_DELIVERY_IMPORT_BYTES + 1} defaultValue={state.draft.paste}
                      aria-describedby={importError ? "receipt-import-help receipt-import-error" : "receipt-import-help"} />
                  </AdminField>
                  <AdminField label="CSV file">
                    <input id="receipt-file" type="file" name="file" accept=".csv,text/csv"
                      aria-describedby={importError ? "receipt-import-help receipt-import-error" : "receipt-import-help"} />
                  </AdminField>
                </div>
                {importError && <p className={styles.error} id="receipt-import-error" tabIndex={-1} role="alert">{importError}</p>}
                <div className={styles.actions}>
                  <button type="submit" name="intent" value="import" className="secondary">{busy === "import" ? "Importing lines…" : "Add imported lines"}</button>
                  <a className="textlink" href="/admin/stock/receive/template" download>Download blank CSV</a>
                </div>
              </div>
            </details>

            <div className={`${styles.columns} ${lineClass}`} aria-hidden="true">
              <span>No.</span><span>Blade code</span><span>Matched blade</span><span>Quantity</span>{showCosts && <span>Unit cost (£)</span>}
            </div>
            <ol className={styles.lines} role="list" aria-label="Delivery lines">
              {ledgerRows.map(({ row, match, matches, quantity, invalidCode, invalidMatch, duplicate, invalidCost, active }, index) => {
                const label = index + 1;
                const initialRow = state.draft.rows[index]!;
                const code = row.code.trim();
                const codeMessage = (showErrors || code || row.sourceRow ? invalidCode : undefined) || duplicate;
                const quantityError = active && quantity === null && (showErrors || row.quantity.trim() || row.sourceRow);
                return (
                  <li className={lineClass} key={row.id}>
                    <input type="hidden" name="row" value={row.id} />
                    {row.sourceRow && <input type="hidden" name={`sourceRow:${row.id}`} value={row.sourceRow} />}
                    <div className={styles.lineNumber} aria-hidden="true"><span>Line</span> {String(label).padStart(2, "0")}</div>
                    <div className={styles.code}>
                      <label htmlFor={rowId(row, "code")} className={styles.fieldLabel}>Blade code</label>
                      <input id={rowId(row, "code")} name={`code:${row.id}`} aria-label={`Blade code for line ${label}`} defaultValue={initialRow.code} placeholder="SKU or maker code"
                        autoComplete="off" spellCheck={false} maxLength={MAX_DELIVERY_CODE_LENGTH}
                        aria-invalid={Boolean(codeMessage)} aria-describedby={codeMessage ? rowId(row, "code-error") : undefined}
                        onKeyDown={(event) => advance(event, row, index, "code")} onBlur={(event) => {
                          const value = event.currentTarget.value.trim();
                          if (!deliveryCodeError(value) && !Array.isArray(checks.get(value))) void checkCodes([value]);
                        }} />
                      {codeMessage && <p className={styles.error} id={rowId(row, "code-error")}>{codeMessage}</p>}
                      {row.sourceRow && <p className={styles.fieldHint}>Imported row {row.sourceRow}</p>}
                    </div>
                    <div className={styles.blade}>
                      {matches.length > 1 && (
                        <>
                          <label htmlFor={rowId(row, "match")} className={styles.fieldHint}>Choose the exact SKU</label>
                          <input type="hidden" name={`selectedCode:${row.id}`} value={code} />
                          <select key={code} id={rowId(row, "match")} name={`selectedId:${row.id}`}
                            aria-label={`Choose the exact SKU for line ${label}`} defaultValue={match?.variantId ?? ""}
                            aria-invalid={invalidMatch} aria-describedby={invalidMatch ? rowId(row, "match-error") : undefined}>
                            <option value="">Choose a blade</option>
                            {matches.map(({ variantId, sku, bladeName }) => <option key={variantId} value={variantId}>{sku} · {bladeName}</option>)}
                          </select>
                        </>
                      )}
                      <div role="status" className={styles.matchStatus}>
                        {match ? <><span>{match.bladeName}</span><span className="admin-mono admin-muted">{match.sku}</span></>
                          : invalidMatch ? <p className={styles.error} id={rowId(row, "match-error")}>Multiple matches. Choose the SKU on the packet or type it in the code field.</p>
                          : <span className="admin-muted">{checks.has(code) || !code ? "—" : "Awaiting match"}</span>}
                      </div>
                    </div>
                    <div className={styles.quantity}>
                      <label htmlFor={rowId(row, "quantity")} className={styles.fieldLabel}>Quantity</label>
                      <input id={rowId(row, "quantity")} name={`quantity:${row.id}`} aria-label={`Quantity for line ${label}`} inputMode="numeric" defaultValue={initialRow.quantity}
                        aria-invalid={Boolean(quantityError)} aria-describedby={quantityError ? rowId(row, "quantity-error") : undefined}
                        maxLength={MAX_DELIVERY_CODE_LENGTH}
                        onKeyDown={(event) => advance(event, row, index, "quantity")} />
                      {quantityError && <p className={styles.error} id={rowId(row, "quantity-error")}>
                        {row.quantity.trim() ? `Use a whole number from 1 to ${quantityMax}.` : "Enter a quantity."}
                      </p>}
                    </div>
                    {showCosts && (
                      <div className={styles.cost}>
                        <label htmlFor={rowId(row, "cost")} className={styles.fieldLabel}>Unit cost (£)</label>
                        <input id={rowId(row, "cost")} name={`unitCost:${row.id}`} aria-label={`Unit cost (£) for line ${label}`} inputMode="decimal" defaultValue={initialRow.unitCost} placeholder="Optional"
                          aria-invalid={invalidCost} aria-describedby={invalidCost ? rowId(row, "cost-error") : undefined} maxLength={MAX_DELIVERY_CODE_LENGTH}
                          onKeyDown={(event) => advance(event, row, index, "unitCost")} />
                        {invalidCost && <p className={styles.error} id={rowId(row, "cost-error")}>Use a valid £ amount, e.g. 4.50.</p>}
                      </div>
                    )}
                    <button className={`${styles.remove} textlink`} type="submit" name="intent" value={`remove:${row.id}`} aria-label={`Remove line ${label}`}>Remove</button>
                  </li>
                );
              })}
            </ol>

            <div className={styles.addLine}>
              <button className="secondary" type="submit" name="intent" value="add" ref={addButton} disabled={draft.rows.length >= MAX_DELIVERY_ROWS}><span aria-hidden="true">+</span> Add line</button>
              <button className="secondary" type="submit" name="intent" value="check">{busy === "check" ? "Checking blade codes…" : "Check blade codes"}</button>
              {draft.rows.length >= MAX_DELIVERY_ROWS && <p className="admin-muted">Maximum of {MAX_DELIVERY_ROWS} lines reached.</p>}
              {state.announcement && <p className="admin-muted" role="status">{state.announcement}</p>}
            </div>
          </section>
          <div className={styles.submitArea}>
            {state.error && !importError && <p className={styles.errorBlock} id="receipt-review-error" role="alert" tabIndex={-1}>{state.error}</p>}
            <div className={styles.actions}>
              <button className="primary" type="submit" name="intent" value="review" id="receipt-review">
                {busy === "review" ? "Checking delivery…" : "Review delivery"}
              </button>
              <p className="admin-muted">You’ll review the delivery before any stock is added.</p>
            </div>
            {busy === "review" && <p className="sr" role="status">Checking delivery lines. Please wait.</p>}
            {busy === "import" && <p className="sr" role="status">Importing delivery lines. Please wait.</p>}
          </div>
        </fieldset>
      )}
    </form>
  );
}
