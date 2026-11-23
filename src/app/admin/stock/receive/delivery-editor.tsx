"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AdminField } from "@/app/admin/ui";
import {
  DELIVERY_QUANTITY_MAX,
  MAX_DELIVERY_CODE_LENGTH,
  MAX_DELIVERY_IMPORT_BYTES,
  MAX_DELIVERY_ROWS,
  hasDeliveryControlCharacters,
  isDeliveryDate,
  parseDeliveryCost,
  parseDeliveryQuantity,
  type DeliveryCommitInput,
  type DeliveryMatch,
  type ImportedDeliveryRow,
} from "@/lib/admin/deliveries";
import { formatGbp } from "@/lib/commerce/money";
import { commitDelivery, importDeliveryLines, lookupDeliveryCodes } from "./actions";
import styles from "./delivery-editor.module.css";

type Row = Omit<ImportedDeliveryRow, "sourceRow"> & { id: number; sourceRow?: number; selectedId?: string };
type CodeCheck = DeliveryMatch[] | { error: string };
type Checks = Map<string, CodeCheck>;
type ReviewedLine = DeliveryCommitInput["lines"][number] & Pick<DeliveryMatch, "bladeName" | "sku">;
type Review = { input: DeliveryCommitInput; lines: ReviewedLine[] };
type CommitError = { error: string; retryOnly: boolean };

const quantityMax = DELIVERY_QUANTITY_MAX.toLocaleString("en-GB");
const displayDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });
const number = new Intl.NumberFormat("en-GB");

function rowId(row: Row, field: string) {
  return `receipt-${row.id}-${field}`;
}

function blankRow(id: number): Row {
  return { id, code: "", quantity: "", unitCost: "" };
}

function codeError(code: string) {
  if (!code) return "Enter a blade code.";
  if (code.length > MAX_DELIVERY_CODE_LENGTH || hasDeliveryControlCharacters(code)) {
    return "Use a single blade code of up to 120 characters.";
  }
  if (!/[a-z0-9]/i.test(code)) return "Include a letter or number from the blade code.";
}

function groupMatches(codes: string[], matches: DeliveryMatch[]): Checks {
  const grouped = new Map<string, DeliveryMatch[]>(codes.map((code) => [code, []]));
  for (const match of matches) {
    grouped.get(match.inputCode)?.push(match);
  }
  return grouped;
}

function readRows(rows: Row[], checks: Checks, showCosts: boolean) {
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const code = row.code.trim();
    const active = Boolean(row.sourceRow || code || row.quantity.trim() || (showCosts && row.unitCost.trim()));
    const check = checks.get(code);
    const matches = Array.isArray(check) ? check : [];
    const match = matches.length === 1 ? matches[0] : matches.find(({ variantId }) => variantId === row.selectedId);
    const earlier = match && seen.get(match.variantId);
    if (match && earlier === undefined) seen.set(match.variantId, index + 1);
    const quantity = parseDeliveryQuantity(row.quantity);
    const unitCostPence = showCosts ? parseDeliveryCost(row.unitCost) : null;
    const invalidCode = active && (codeError(code)
      || (check && !Array.isArray(check) ? check.error : undefined)
      || (check && matches.length === 0 ? "No match. Check the code or enter the exact SKU." : undefined));
    const invalidMatch = matches.length > 1 && !match;
    const duplicate = earlier ? `Same blade as line ${earlier}. Combine the quantities and remove this line.` : undefined;
    const invalidCost = showCosts && Boolean(row.unitCost.trim()) && unitCostPence === null;
    const ready = Boolean(active && match && !invalidCode && !duplicate && quantity !== null && !invalidCost);
    return { row, active, match, matches, quantity, unitCostPence, invalidCode, invalidMatch, duplicate, invalidCost, ready };
  });
}

export function DeliveryEditor({ showCosts, today }: { showCosts: boolean; today: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([blankRow(1)]);
  const [checks, setChecks] = useState<Checks>(() => new Map());
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState<"import" | "review" | "commit" | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [commitError, setCommitError] = useState<CommitError | null>(null);
  const [importType, setImportType] = useState<"paste" | "file">("paste");
  const [paste, setPaste] = useState("");
  const [importError, setImportError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [focus, setFocus] = useState<{ id: string }>();
  const nextRow = useRef(2);
  const deliveryId = useRef<string | null>(null);
  const pending = useRef(new Map<string, Promise<Checks>>());
  const importing = useRef<HTMLDetailsElement>(null);
  const operation = useRef(false);
  const ledgerRows = readRows(rows, checks, showCosts);
  const entered = ledgerRows.filter(({ active }) => active).length;
  const ready = ledgerRows.filter((line) => line.ready);
  const units = ready.reduce((total, { quantity }) => total + (quantity ?? 0), 0);
  const reviewedUnits = review?.lines.reduce((total, line) => total + line.quantity, 0) ?? 0;
  const referenceError = !reference.trim() ? "Enter a delivery reference."
    : reference.trim().length > MAX_DELIVERY_CODE_LENGTH || hasDeliveryControlCharacters(reference.trim())
      ? "Use a single reference of up to 120 characters." : undefined;
  const dateError = !isDeliveryDate(receivedOn) || receivedOn > today ? "Enter a received date of today or earlier." : undefined;
  const noteError = note.length > 500 || note.includes("\0") ? "Use a note of up to 500 characters." : undefined;
  const lineClass = `${styles.line} ${showCosts ? styles.withCost : ""}`;

  useEffect(() => {
    if (focus) document.getElementById(focus.id)?.focus();
  }, [focus]);

  const warnOnUnload = busy === "commit" || Boolean(commitError?.retryOnly);
  useEffect(() => {
    if (!warnOnUnload) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [warnOnUnload]);

  async function checkCodes(codes: string[]) {
    const fresh = codes.filter((code) => !pending.current.has(code));
    if (fresh.length) {
      const request = lookupDeliveryCodes(fresh)
        .catch(() => ({ ok: false as const, error: "Could not check blade codes. Try reviewing again." }))
        .then((result): Checks => {
          const next = result.ok ? groupMatches(fresh, result.matches) : new Map(fresh.map((code) => [code, { error: result.error }]));
          setChecks((previous) => new Map([...previous, ...next]));
          return next;
        })
        .finally(() => {
          fresh.forEach((code) => pending.current.delete(code));
        });
      fresh.forEach((code) => pending.current.set(code, request));
    }

    const batches = new Set(codes.map((code) => pending.current.get(code)));
    const results = await Promise.all(batches);
    return new Map(results.flatMap((result) => result ? [...result] : []));
  }

  function editRow(row: Row, field: "code" | "quantity" | "unitCost" | "selectedId", value: string) {
    setReviewError("");
    setRows((previous) => previous.map((item) => item.id === row.id
      ? { ...item, [field]: value, ...(field === "code" && value.trim() !== item.code.trim() ? { selectedId: undefined } : {}) }
      : item));
  }

  function addLine() {
    if (rows.length >= MAX_DELIVERY_ROWS) return;
    const row = blankRow(nextRow.current++);
    setRows((previous) => [...previous, row]);
    setFocus({ id: rowId(row, "code") });
  }

  function removeLine(index: number) {
    const remaining = rows.filter((_, rowIndex) => index !== rowIndex);
    if (!remaining.length) remaining.push(blankRow(nextRow.current++));
    setRows(remaining);
    setReviewError("");
    setAnnouncement(`Line ${index + 1} removed.`);
    setFocus({ id: rowId(remaining[Math.min(index, remaining.length - 1)]!, "code") });
  }

  function advance(event: KeyboardEvent<HTMLInputElement>, row: Row, index: number, field: "code" | "quantity" | "unitCost") {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const next = rows[index + 1];
    if (field === "code") {
      document.getElementById(rowId(row, "quantity"))?.focus();
    } else if (field === "quantity" && showCosts) {
      document.getElementById(rowId(row, "cost"))?.focus();
    } else if (next) {
      document.getElementById(rowId(next, "code"))?.focus();
    } else if (row.code.trim() || row.quantity.trim() || row.unitCost.trim()) {
      addLine();
    }
  }

  async function importLines(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    const size = file instanceof File ? file.size : new TextEncoder().encode(paste).byteLength;
    if (importType === "file" ? !size : !paste.trim()) {
      setImportError(importType === "file" ? "Choose a CSV file." : "Paste at least one row from your spreadsheet.");
      setFocus({ id: `receipt-${importType}` });
      return;
    }
    if (size > MAX_DELIVERY_IMPORT_BYTES) {
      setImportError("Use a file or pasted table no larger than 128 KB.");
      setFocus({ id: `receipt-${importType}` });
      return;
    }

    operation.current = true;
    setImportError("");
    setBusy("import");
    try {
      const result = await importDeliveryLines(form);
      if (!result.ok) {
        setImportError(result.error);
        setFocus({ id: `receipt-${importType}` });
        return;
      }
      const existing = ledgerRows.filter(({ active }) => active).map(({ row }) => row);
      if (existing.length + result.rows.length > MAX_DELIVERY_ROWS) {
        setImportError(`A delivery can have up to ${MAX_DELIVERY_ROWS} lines. Remove existing lines or import a smaller table.`);
        setFocus({ id: "receipt-import-error" });
        return;
      }
      const added = result.rows.map((row) => ({ ...row, unitCost: showCosts ? row.unitCost : "", id: nextRow.current++ }));
      const first = added[0];
      if (!first) return;
      setChecks((previous) => new Map([...previous, ...groupMatches(added.map(({ code }) => code.trim()), result.matches)]));
      setRows([...existing, ...added]);
      setPaste("");
      setReviewError("");
      setAnnouncement(`${added.length} ${added.length === 1 ? "line" : "lines"} imported. Check the matched blades and quantities.`);
      if (importing.current) importing.current.open = false;
      setFocus({ id: rowId(first, "code") });
    } catch {
      setImportError("Could not import the table. Try again.");
      setFocus({ id: "receipt-import-error" });
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  async function reviewDelivery() {
    if (operation.current) return;
    setShowErrors(true);
    setReviewError("");
    const invalidDetail = referenceError ? "reference" : dateError ? "date" : noteError ? "note" : null;
    if (invalidDetail) {
      setFocus({ id: `receipt-${invalidDetail}` });
      return;
    }
    if (!entered) {
      setReviewError("Add at least one delivery line.");
      setFocus({ id: rowId(rows[0]!, "code") });
      return;
    }

    operation.current = true;
    setBusy("review");
    try {
      const codes = [...new Set(rows.map(({ code }) => code.trim()).filter((code) => !codeError(code)))];
      const verified = await checkCodes(codes);
      const lines: ReviewedLine[] = [];
      for (const line of readRows(rows, verified, showCosts)) {
        if (!line.active) continue;
        const { row, match, quantity, unitCostPence, invalidCost, invalidCode, invalidMatch, duplicate } = line;
        if (!match || quantity === null || invalidCost || invalidCode || duplicate) {
          setReviewError("Check the marked lines before reviewing this delivery.");
          const field = invalidMatch ? "match" : invalidCode || duplicate || !match ? "code" : quantity === null ? "quantity" : "cost";
          setFocus({ id: rowId(row, field) });
          return;
        }
        lines.push({ variantId: match.variantId, sku: match.sku, bladeName: match.bladeName, quantity, unitCostPence });
      }
      deliveryId.current ??= crypto.randomUUID();
      setReview({ lines, input: {
        id: deliveryId.current,
        reference: reference.trim(),
        receivedOn,
        note: note.trim(),
        lines: lines.map(({ variantId, quantity, unitCostPence }) => ({ variantId, quantity, unitCostPence })),
      } });
      setFocus({ id: "receipt-review-heading" });
    } catch {
      setReviewError("Could not prepare the review. Try again.");
      setFocus({ id: "receipt-review-error" });
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  async function receiveStock() {
    if (!review || operation.current) return;
    operation.current = true;
    setBusy("commit");
    try {
      const result = await commitDelivery(review.input);
      if (result.ok) {
        router.replace(`/admin/stock/deliveries/${result.id}`);
        return;
      }
      setCommitError(result);
    } catch {
      setCommitError({ error: "Could not confirm the receipt. Retry this review or check delivery history before starting again.", retryOnly: true });
    }
    operation.current = false;
    setBusy(null);
    setFocus({ id: "receipt-commit-error" });
  }

  return (
    <div className={styles.editor}>
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
            {commitError && busy !== "commit" && (
              <div className={styles.errorBlock} id="receipt-commit-error" tabIndex={-1} role="alert">
                <p>{commitError.error}</p>
                {commitError.retryOnly && (
                  <a className="textlink" href="/admin/stock/deliveries" target="_blank" rel="noopener">
                    Check delivery history (opens in a new tab)
                  </a>
                )}
              </div>
            )}
            <div className={styles.actions}>
              {!commitError?.retryOnly && <button className="secondary" type="button" disabled={busy === "commit"} onClick={() => {
                setCommitError(null);
                setReview(null);
                setFocus({ id: "receipt-review" });
              }}>Back to edit</button>}
              <button className="primary" type="button" disabled={busy === "commit"} onClick={receiveStock}>
                {busy === "commit" ? "Receiving stock…" : commitError ? "Retry receiving stock" : "Receive stock"}
              </button>
            </div>
            {busy === "commit" && <p className="sr" role="status">Receiving stock. Please wait.</p>}
          </div>
        </section>
      ) : (
        <fieldset className={styles.editing} disabled={busy !== null}>
          <legend className="sr">Enter delivery</legend>
          <section className={styles.sheet} aria-labelledby="receipt-details-heading">
            <div className={styles.sheetHeader}>
              <h2 id="receipt-details-heading">Delivery details</h2>
              <p>Use the reference from your delivery paperwork.</p>
            </div>
            <div className={styles.metadata}>
              <div>
                <AdminField label="Delivery reference">
                  <input id="receipt-reference" value={reference} maxLength={MAX_DELIVERY_CODE_LENGTH} required autoComplete="off"
                    aria-invalid={showErrors && Boolean(referenceError)} aria-describedby={showErrors && referenceError ? "receipt-reference-error" : undefined}
                    onChange={(event) => setReference(event.target.value)} />
                </AdminField>
                {showErrors && referenceError && <p className={styles.error} id="receipt-reference-error">{referenceError}</p>}
              </div>
              <div>
                <AdminField label="Date received">
                  <input id="receipt-date" type="date" required max={today} value={receivedOn}
                    aria-invalid={showErrors && Boolean(dateError)} aria-describedby={showErrors && dateError ? "receipt-date-error" : undefined}
                    onChange={(event) => setReceivedOn(event.target.value)} />
                </AdminField>
                {showErrors && dateError && <p className={styles.error} id="receipt-date-error">{dateError}</p>}
              </div>
              <div className={styles.note}>
                <AdminField label="Delivery note (optional)">
                  <textarea id="receipt-note" rows={1} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)}
                    aria-invalid={showErrors && Boolean(noteError)} aria-describedby={showErrors && noteError ? "receipt-note-error" : undefined} />
                </AdminField>
                {showErrors && noteError && <p className={styles.error} id="receipt-note-error">{noteError}</p>}
              </div>
            </div>
          </section>

          <section className={styles.sheet} aria-labelledby="receipt-lines-heading">
            <div className={`${styles.sheetHeader} ${styles.ledgerHeader}`}>
              <div>
                <h2 id="receipt-lines-heading">Delivery lines</h2>
                <p>Enter a SKU or maker code. Press Enter to move to the next field or line.</p>
                {showCosts && <p>Unit cost is optional. Enter pounds per blade.</p>}
              </div>
              <dl className={styles.tally}>
                <div><dt>Lines ready</dt><dd>{ready.length}<span> / {entered}</span></dd></div>
                <div><dt>Units ready</dt><dd>{number.format(units)}</dd></div>
              </dl>
            </div>

            <details className={styles.import} ref={importing}>
              <summary>Import lines</summary>
              <form className={styles.importForm} onSubmit={importLines} noValidate>
                <div className={styles.importModes} aria-label="Import method" role="group">
                  {[["paste", "Paste table"], ["file", "Upload CSV"]].map(([type, label]) => (
                    <button key={type} type="button" className="secondary" aria-pressed={importType === type} onClick={() => {
                      setImportType(type === "paste" ? "paste" : "file");
                      setImportError("");
                    }}>{label}</button>
                  ))}
                </div>
                <p id="receipt-import-help">Use columns in this order: code, quantity{showCosts ? ", optional unit cost" : ""}. Up to 200 lines and 128 KB.</p>
                {importType === "paste" ? (
                  <AdminField label="Spreadsheet rows">
                    <textarea id="receipt-paste" name="paste" rows={4} value={paste} onChange={(event) => { setPaste(event.target.value); setImportError(""); }}
                      aria-describedby={importError ? "receipt-import-help receipt-import-error" : "receipt-import-help"} />
                  </AdminField>
                ) : (
                  <AdminField label="CSV file">
                    <input id="receipt-file" type="file" name="file" accept=".csv,text/csv" onChange={() => setImportError("")}
                      aria-describedby={importError ? "receipt-import-help receipt-import-error" : "receipt-import-help"} />
                  </AdminField>
                )}
                {importError && <p className={styles.error} id="receipt-import-error" tabIndex={-1} role="alert">{importError}</p>}
                <div className={styles.actions}>
                  <button type="submit" className="secondary">{busy === "import" ? "Importing lines…" : "Add imported lines"}</button>
                  <a className="textlink" href="/admin/stock/receive/template" download>Download blank CSV</a>
                </div>
              </form>
            </details>

            <div className={`${styles.columns} ${lineClass}`} aria-hidden="true">
              <span>No.</span><span>Blade code</span><span>Matched blade</span><span>Quantity</span>{showCosts && <span>Unit cost (£)</span>}
            </div>
            <ol className={styles.lines} role="list" aria-label="Delivery lines">
              {ledgerRows.map(({ row, match, matches, quantity, invalidCode, invalidMatch, duplicate, invalidCost, active }, index) => {
                const label = index + 1;
                const code = row.code.trim();
                const codeMessage = (showErrors || code || row.sourceRow ? invalidCode : undefined) || duplicate;
                const quantityError = active && quantity === null && (showErrors || row.quantity.trim() || row.sourceRow);
                return (
                  <li className={lineClass} key={row.id}>
                    <div className={styles.lineNumber} aria-hidden="true"><span>Line</span> {String(label).padStart(2, "0")}</div>
                    <div className={styles.code}>
                      <label htmlFor={rowId(row, "code")} className={styles.fieldLabel}>Blade code</label>
                      <input id={rowId(row, "code")} aria-label={`Blade code for line ${label}`} value={row.code} placeholder="SKU or maker code"
                        autoComplete="off" spellCheck={false} maxLength={MAX_DELIVERY_CODE_LENGTH}
                        aria-invalid={Boolean(codeMessage)} aria-describedby={codeMessage ? rowId(row, "code-error") : undefined}
                        onChange={(event) => editRow(row, "code", event.target.value)}
                        onKeyDown={(event) => advance(event, row, index, "code")} onBlur={(event) => {
                          const value = event.currentTarget.value.trim();
                          if (!codeError(value) && !Array.isArray(checks.get(value))) void checkCodes([value]);
                        }} />
                      {codeMessage && <p className={styles.error} id={rowId(row, "code-error")}>{codeMessage}</p>}
                      {row.sourceRow && <p className={styles.fieldHint}>Imported row {row.sourceRow}</p>}
                    </div>
                    <div className={styles.blade}>
                      {matches.length > 1 && (
                        <>
                          <label htmlFor={rowId(row, "match")} className={styles.fieldHint}>Choose the exact SKU</label>
                          <select id={rowId(row, "match")} aria-label={`Matched blade for line ${label}`} value={match?.variantId ?? ""}
                            aria-invalid={invalidMatch} aria-describedby={invalidMatch ? rowId(row, "match-error") : undefined}
                            onChange={(event) => editRow(row, "selectedId", event.target.value)}>
                            <option value="">Choose a blade</option>
                            {matches.map(({ variantId, sku, bladeName }) => <option key={variantId} value={variantId}>{sku} · {bladeName}</option>)}
                          </select>
                        </>
                      )}
                      <div role="status" className={styles.matchStatus}>
                        {match ? <><span>{match.bladeName}</span><span className="admin-mono admin-muted">{match.sku}</span></>
                          : invalidMatch ? <p className={styles.error} id={rowId(row, "match-error")}>Multiple matches. Choose the SKU on the packet.</p>
                          : <span className="admin-muted">{checks.has(code) || !code ? "—" : "Awaiting match"}</span>}
                      </div>
                    </div>
                    <div className={styles.quantity}>
                      <label htmlFor={rowId(row, "quantity")} className={styles.fieldLabel}>Quantity</label>
                      <input id={rowId(row, "quantity")} aria-label={`Quantity for line ${label}`} inputMode="numeric" value={row.quantity}
                        aria-invalid={Boolean(quantityError)} aria-describedby={quantityError ? rowId(row, "quantity-error") : undefined}
                        maxLength={MAX_DELIVERY_CODE_LENGTH}
                        onChange={(event) => editRow(row, "quantity", event.target.value)} onKeyDown={(event) => advance(event, row, index, "quantity")} />
                      {quantityError && <p className={styles.error} id={rowId(row, "quantity-error")}>
                        {row.quantity.trim() ? `Use a whole number from 1 to ${quantityMax}.` : "Enter a quantity."}
                      </p>}
                    </div>
                    {showCosts && (
                      <div className={styles.cost}>
                        <label htmlFor={rowId(row, "cost")} className={styles.fieldLabel}>Unit cost (£)</label>
                        <input id={rowId(row, "cost")} aria-label={`Unit cost for line ${label}`} inputMode="decimal" value={row.unitCost} placeholder="Optional"
                          aria-invalid={invalidCost} aria-describedby={invalidCost ? rowId(row, "cost-error") : undefined} maxLength={MAX_DELIVERY_CODE_LENGTH}
                          onChange={(event) => editRow(row, "unitCost", event.target.value)} onKeyDown={(event) => advance(event, row, index, "unitCost")} />
                        {invalidCost && <p className={styles.error} id={rowId(row, "cost-error")}>Use a valid £ amount, e.g. 4.50.</p>}
                      </div>
                    )}
                    <button className={`${styles.remove} textlink`} type="button" aria-label={`Remove line ${label}`} onClick={() => removeLine(index)}>Remove</button>
                  </li>
                );
              })}
            </ol>

            <div className={styles.addLine}>
              <button className="secondary" type="button" disabled={rows.length >= MAX_DELIVERY_ROWS} onClick={addLine}><span aria-hidden="true">+</span> Add line</button>
              {rows.length >= MAX_DELIVERY_ROWS && <p className="admin-muted">Maximum of {MAX_DELIVERY_ROWS} lines reached.</p>}
              <p className="admin-muted" role="status">{announcement}</p>
            </div>
          </section>
          <div className={styles.submitArea}>
            {reviewError && <p className={styles.errorBlock} id="receipt-review-error" role="alert" tabIndex={-1}>{reviewError}</p>}
            <div className={styles.actions}>
              <button className="primary" type="button" id="receipt-review" onClick={reviewDelivery}>
                {busy === "review" ? "Checking delivery…" : "Review delivery"}
              </button>
              <p className="admin-muted">You’ll review the delivery before any stock is added.</p>
            </div>
            {busy === "review" && <p className="sr" role="status">Checking delivery lines. Please wait.</p>}
            {busy === "import" && <p className="sr" role="status">Importing delivery lines. Please wait.</p>}
          </div>
        </fieldset>
      )}
    </div>
  );
}
