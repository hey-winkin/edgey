"use client";

import Image from "next/image";
import { useActionState, useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { AdminField, AdminLink, AdminSection } from "@/app/admin/ui";
import type { PurchaseVariant } from "@/lib/admin/purchase-catalogue";
import { formatPoundsInput, POUNDS_INPUT_PATTERN } from "@/lib/admin/pounds";
import { submitPurchaseEditor } from "./actions";
import { captureEarlyPurchaseEditor, restoreEarlyPurchaseFields } from "./early-editor";
import {
  currencies, maxCodeLength, maxNoteLength, maxOrderNoteLength, maxPartNumberLength, maxPurchaseLines,
  purchaseCurrency, type PurchaseEditorState, type PurchaseLine,
} from "./editor-data";
import type { PurchaseBrand, PurchaseSupplierOption } from "./editor-load";
import styles from "./purchase-editor.module.css";

export function PurchaseEditor({ initial, brands, suppliers, canAddDraft, permalink }: {
  initial: PurchaseEditorState;
  brands: PurchaseBrand[];
  suppliers: PurchaseSupplierOption[];
  canAddDraft: boolean;
  permalink: string;
}) {
  const [state, action, pending] = useActionState(submitPurchaseEditor, initial, permalink);
  return <>
    <script dangerouslySetInnerHTML={{ __html: captureEarlyPurchaseEditor }} />
    <form id="purchase-editor" className={styles.editor} action={action} aria-busy={pending} noValidate
      onReset={(event) => event.preventDefault()}>
      <button type="submit" disabled hidden aria-hidden="true" />
      <fieldset disabled={pending}>
        <EditorFields key={state.response} {...{ state, brands, suppliers, canAddDraft, pending }} />
      </fieldset>
    </form>
  </>;
}

function Product({ product, compact = false }: { product: PurchaseVariant; compact?: boolean }) {
  return <div className={`${styles.product} ${compact ? styles.compact : ""}`}>
    <span className={styles.plate}>
      {product.drawing ? <Image src={`/line-art/${product.drawing}`} alt={`Line drawing for ${product.sku}`}
        width={76} height={48} unoptimized /> : <span aria-hidden="true">{product.sku}</span>}
    </span>
    <div>
      <strong>{product.name}</strong>
      {product.option && <span className="admin-muted">{product.option}</span>}
      <span className={styles.productMeta}>
        <code className="admin-mono">{product.sku}</code>
        {product.status !== "published" && <small>{product.status === "draft" ? "Draft" : "Archived"}</small>}
      </span>
    </div>
  </div>;
}

function AddDraft({ allowed }: { allowed: boolean }) {
  return allowed
    ? <a className="textlink" href="/admin/catalogue/new" target="_blank" rel="noopener noreferrer">Add draft variant <span className="admin-muted">(opens in a new tab)</span></a>
    : <span className="admin-muted">Ask a catalogue user to add the missing draft variant.</span>;
}

function ErrorAt({ state, area }: { state: PurchaseEditorState; area?: "picker" | "exact" | "import" }) {
  if (!state.error || state.error.area !== area) return null;
  return <p id={area ? `po-${area}-error` : "po-save-error"} className="admin-notice" role="alert" tabIndex={-1}>{state.error.message}</p>;
}

function invalidField(state: PurchaseEditorState, id: string) {
  if (state.error?.field !== id) return {};
  return { "aria-invalid": true as const, "aria-describedby": state.error.area ? `po-${state.error.area}-error` : "po-save-error" };
}

function intentButton(intent: string, pending: boolean, children: ReactNode, props?: {
  id?: string; label?: string; prominent?: boolean; disabled?: boolean;
}) {
  return <button type="submit" name="intent" value={intent} id={props?.id} aria-label={props?.label}
    className={props?.prominent ? "primary" : `admin-secondary ${styles.secondary}`} disabled={pending || props?.disabled}>{children}</button>;
}

function EditorFields({ state, brands, suppliers, canAddDraft, pending }: {
  state: PurchaseEditorState;
  brands: PurchaseBrand[];
  suppliers: PurchaseSupplierOption[];
  canAddDraft: boolean;
  pending: boolean;
}) {
  const { header, lines, status, results, query, brand, page, more, notice, suggestions } = state;
  const [scope, setScope] = useState({ currency: header.currency, supplier: header.supplier });
  const [currency, supplier] = [scope.currency, scope.supplier];
  const ordered = new Set(lines.map(({ product }) => product.id));
  const lockSupplier = status !== "draft";
  const supplierRecord = suppliers.find((item) => item.id === supplier);
  const samePriceScope = currency === header.currency && supplier === header.supplier;

  const attach = useCallback((root: HTMLDivElement | null) => {
    const form = root?.closest("form");
    if (!form) return;
    restoreEarlyPurchaseFields(form);
    const currency = form.elements.namedItem("currency");
    const supplier = form.elements.namedItem("supplier_id");
    if (currency instanceof HTMLSelectElement && purchaseCurrency(currency.value) && supplier instanceof HTMLSelectElement) {
      setScope({ currency: currency.value, supplier: supplier.value });
    }
  }, []);

  useEffect(() => {
    if (state.focus && (!document.activeElement?.closest("#purchase-editor") || document.activeElement === document.body)) {
      document.getElementById(state.focus)?.focus();
    }
  }, [state.focus]);

  function advance(event: KeyboardEvent<HTMLDivElement>) {
    const input = event.target;
    if (event.key !== "Enter" || event.nativeEvent.isComposing || !(input instanceof HTMLInputElement)) return;
    if (input.name === "q" || input.name === "exact") {
      event.preventDefault();
      const button = document.getElementById(input.name === "q" ? "po-search-button" : "po-exact-button");
      if (button instanceof HTMLButtonElement && !button.disabled) input.form?.requestSubmit(button);
    } else if (input.name.startsWith("quantity:") || input.name.startsWith("price:")) {
      event.preventDefault();
      const row = input.closest("li");
      const next = input.name.startsWith("quantity:") ? row?.querySelector<HTMLInputElement>('input[name^="price:"]') :
        row?.nextElementSibling?.querySelector<HTMLInputElement>('input[name^="quantity:"]');
      (next ?? document.getElementById("po-save"))?.focus();
    }
  }

  return <div ref={attach} onKeyDown={advance}>
    <input type="hidden" name="order_id" value={state.id} />
    <input type="hidden" name="revision" value={state.revision} />
    {notice && <p className={styles.announcement} role="status">{notice}</p>}

    <AdminSection title="Pick from the catalogue">
      <div className={`admin-panel ${styles.catalogue}`}>
        <div className={styles.search}>
          <AdminField label="Search products">
            <input id="po-search" name="q" type="search" maxLength={maxCodeLength} defaultValue={query}
              placeholder="Code, product name or maker reference" autoComplete="off" />
          </AdminField>
          <AdminField label="Machine brand">
            <select name="brand" defaultValue={brand}>
              <option value="">All machine brands</option>
              {brands.map(({ slug, name }) => <option key={slug} value={slug}>{name}</option>)}
            </select>
          </AdminField>
          {intentButton("search", pending, "Search", { id: "po-search-button" })}
        </div>

        <div id="po-results" role="region" aria-label="Catalogue results" tabIndex={-1}>
          <p className={`admin-muted ${styles.pickerHint}`}>Draft products are included. Archived products are not shown.</p>
          <ErrorAt state={state} area="picker" />
          {results.length ? <>
            <ul className={styles.results} aria-label="Matching products">
              {results.map((product) => <li key={product.id}>
                <Product product={product} compact />
                {intentButton(`add:${product.id}`, pending, ordered.has(product.id) ? "Added" : "Add",
                  { label: ordered.has(product.id) ? `Added: ${product.sku}` : `Add ${product.sku}`,
                    disabled: ordered.has(product.id) || lines.length >= maxPurchaseLines })}
              </li>)}
            </ul>
            {(page > 1 || more) && <div className="admin-pagination" aria-label="Catalogue pages">
              {page > 1 && intentButton("page:previous", pending, "Previous")}
              <span className="admin-muted">Page {page}</span>
              {more && intentButton("page:next", pending, "Next")}
            </div>}
          </> : <p className={styles.pickerHint}>No matching products. <AddDraft allowed={canAddDraft} /></p>}
        </div>

        <details className={styles.disclosure} open={Boolean(state.error?.area === "exact" || state.focus === "exact" || state.exact) || undefined}>
          <summary>Enter an exact code</summary>
          <div className={styles.secondaryEntry}>
            <AdminField label="Exact Edgey code or maker reference">
              <input name="exact" id="exact" maxLength={maxCodeLength} defaultValue={state.exact}
                autoComplete="off" {...invalidField(state, "exact")} />
            </AdminField>
            {intentButton("exact", pending, "Add by code", { id: "po-exact-button", disabled: lines.length >= maxPurchaseLines })}
          </div>
          <ErrorAt state={state} area="exact" />
          {state.error?.area === "exact" && <AddDraft allowed={canAddDraft} />}
        </details>

        <details className={styles.disclosure} open={Boolean(state.paste || state.error?.area === "import") || undefined}>
          <summary id="po-import-toggle">Import lines</summary>
          <p className="admin-muted">
            Paste spreadsheet cells or upload a UTF-8 CSV. Use code, quantity, and optional unit price, supplier part number and line note columns, in that order.
            Enter prices excluding VAT, in the selected order currency.
          </p>
          <div className={styles.importFields}>
            <AdminField label="Paste spreadsheet rows">
              <textarea name="paste" id="paste" rows={3} defaultValue={state.paste} {...invalidField(state, "paste")} />
            </AdminField>
            <AdminField label="Upload a CSV">
              <input type="file" name="file" id="file" accept=".csv,text/csv" {...invalidField(state, "file")} />
            </AdminField>
            <div className={styles.actions}>
              {intentButton("preview", pending, "Preview import")}
              {intentButton("clearImport", pending, "Clear import")}
            </div>
          </div>
          <ErrorAt state={state} area="import" />
          {state.preview && <div id="po-import-preview" tabIndex={-1} className={styles.importPreview}>
            <h3>Import preview</h3>
            {currency !== header.currency && <p className="admin-muted">The currency changed. Preview the table again before adding lines.</p>}
            <ol className={styles.previewRows}>
              {state.preview.map((row) => <li key={row.sourceRow}>
                <span className="admin-muted">Row {row.sourceRow}</span>
                <span><strong>{row.product?.sku ?? row.code}</strong> {row.product?.name}
                  {row.product?.option && <> · {row.product.option}</>}
                  {row.error && <small className={styles.previewError}>{row.error}</small>}
                </span>
                <span>Qty {row.quantity || "—"}</span>
                <span>{row.unitPrice ? `${header.currency} ${row.unitPrice}` : "No price"}</span>
              </li>)}
            </ol>
            {state.preview.some((row) => !row.product)
              && <p className={styles.pickerHint}>Missing from the catalogue? <AddDraft allowed={canAddDraft} /></p>}
            {intentButton("addImport", pending, `Add ${state.preview.length} ${state.preview.length === 1 ? "line" : "lines"}`, {
              prominent: true, disabled: currency !== header.currency || state.preview.some(({ error }) => Boolean(error))
                || state.preview.length + lines.length > maxPurchaseLines,
            })}
          </div>}
        </details>
      </div>
    </AdminSection>

    <AdminSection title="Order details">
      <div className={`admin-panel ${styles.order}`}>
        {lockSupplier && <>
          <input type="hidden" name="supplier_id" value={header.supplier} />
          <input type="hidden" name="currency" value={header.currency} />
        </>}
        <div className={styles.headerFields}>
          {lockSupplier ? <>
            <p><span className="admin-muted">Supplier</span><br /><strong>{supplierRecord?.name}</strong></p>
            <p><span className="admin-muted">Currency</span><br /><strong>{header.currency}</strong></p>
          </> : <>
            <AdminField label="Supplier">
              <select name="supplier_id" id="supplier_id" defaultValue={header.supplier} {...invalidField(state, "supplier_id")}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setScope((current) => ({ ...current, supplier: value }));
                }}>
                <option value="">Choose a supplier</option>
                {suppliers.map(({ id, name, default_currency }) => <option key={id} value={id}>
                  {name}{default_currency ? ` · default ${default_currency}` : ""}
                </option>)}
              </select>
            </AdminField>
            <AdminField label="Order currency">
              <select name="currency" id="currency" defaultValue={header.currency} {...invalidField(state, "currency")}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (purchaseCurrency(value)) setScope((current) => ({ ...current, currency: value }));
                }}>
                  {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
              </select>
            </AdminField>
          </>}
          <AdminField label="Order date"><input type="date" name="ordered_on" id="ordered_on" defaultValue={header.ordered}
            {...invalidField(state, "ordered_on")} /></AdminField>
          <AdminField label="Expected date (optional)"><input type="date" name="expected_on" id="expected_on" defaultValue={header.expected}
            {...invalidField(state, "expected_on")} /></AdminField>
        </div>
        {!suppliers.length && <p className="admin-muted">
          No suppliers yet. You can save an incomplete draft, or <AdminLink href="/admin/purchase-orders/suppliers/new">add a supplier</AdminLink>.
        </p>}
        <div className={styles.exchange} data-fixed={lockSupplier && header.currency === "GBP" ? "true" : undefined}>
          <AdminField label="Exchange rate (GBP per 1 unit of order currency)">
            <input id="exchange_rate" name="exchange_rate" inputMode="decimal" maxLength={16}
              defaultValue={header.exchange} {...invalidField(state, "exchange_rate")} />
          </AdminField>
          <p className="admin-muted">Enter the agreed rate; no live conversion. GBP orders always use 1.</p>
        </div>
        {!lockSupplier && lines.length > 0 && <p className="admin-muted">Changing the order currency does not convert amounts already entered.</p>}
      </div>
    </AdminSection>

    <AdminSection title="Order lines">
      <div id="po-lines" role="group" aria-label="Order lines" tabIndex={-1}>
        {lines.length ? <ul className={styles.lines} aria-label="Selected products">
          {lines.map((line) => <Line key={line.product.id} {...{ line, state, pending, currency }}
            suggestion={samePriceScope ? suggestions[line.product.id] : undefined} />)}
        </ul> : <p className="admin-notice">No lines yet. Use the catalogue above to add the first product.</p>}
      </div>
    </AdminSection>

    <details className={`admin-panel ${styles.charges}`} open={
      ["shipping_minor", "duty_minor", "other_minor", "import_vat_minor", "include_import_vat", "order_note"].includes(state.error?.field ?? "") || undefined
    }>
      <summary>Charges and order note</summary>
      <p className="admin-muted">Enter all charges in the selected order currency.</p>
      <p className="admin-muted">For charges billed in GBP on a foreign currency PO, divide the GBP amount by the exchange rate shown above before entering it.</p>
      <div className={styles.headerFields}>
        <MoneyField label="Shipping" id="shipping_minor" value={header.shipping} state={state} />
        <MoneyField label="Duty" id="duty_minor" value={header.duty} state={state} />
        <MoneyField label="Other charges" id="other_minor" value={header.other} state={state} />
        <MoneyField label="Import VAT" id="import_vat_minor" value={header.vat} state={state} />
      </div>
      <AdminField label="Import VAT treatment">
        <select id="include_import_vat" name="include_import_vat" defaultValue={header.vatPolicy} {...invalidField(state, "include_import_vat")}>
          <option value="">Not specified</option>
          <option value="include">Include import VAT in landed cost</option>
          <option value="exclude">Exclude import VAT from landed cost</option>
        </select>
      </AdminField>
      <p className="admin-muted">Choose a treatment before sending an order with import VAT. Check with finance whether the VAT is recoverable.</p>
      <AdminField label="Order note (optional)">
        <textarea id="order_note" name="order_note" rows={3} maxLength={maxOrderNoteLength} defaultValue={header.note}
          {...invalidField(state, "order_note")} />
      </AdminField>
    </details>

    <div className={styles.save}>
      {intentButton("save", pending, pending ? "Working…" : status === "draft" ? "Save draft" : "Save amendment",
        { id: "po-save", prominent: true })}
      <ErrorAt state={state} />
    </div>
  </div>;
}

function MoneyField({ label, id, value, state }: { label: string; id: string; value: string; state: PurchaseEditorState }) {
  return <AdminField label={label}><input id={id} name={id} defaultValue={value} inputMode="decimal" placeholder="0.00"
    autoComplete="off" pattern={POUNDS_INPUT_PATTERN} maxLength={11} {...invalidField(state, id)} /></AdminField>;
}

function Line({ line, state, pending, currency, suggestion }: {
  line: PurchaseLine; state: PurchaseEditorState; pending: boolean; currency: string; suggestion?: number;
}) {
  const { product, quantity, unitPrice, supplierPart, note, received } = line;
  const detail = state.error?.field === `part:${product.id}` || state.error?.field === `note:${product.id}`;
  return <li className={styles.line}>
    <input type="hidden" name="line" value={product.id} />
    <div className={styles.lineGrid}>
      <div>
        <Product product={product} />
        {received > 0 && <p className="admin-muted">{received.toLocaleString("en-GB")} received</p>}
      </div>
      <AdminField label="Quantity">
        <input id={`quantity:${product.id}`} name={`quantity:${product.id}`} defaultValue={quantity}
          inputMode="numeric" maxLength={10} autoComplete="off" {...invalidField(state, `quantity:${product.id}`)} />
      </AdminField>
      <div className={styles.linePrice}>
        <MoneyField label="Unit price ex VAT (order currency)" id={`price:${product.id}`} value={unitPrice} state={state} />
        <div className={styles.priceTools}>
          {suggestion !== undefined
            ? intentButton(`usePrice:${product.id}`, pending, `Use last paid · ${currency} ${formatPoundsInput(suggestion)}`,
              { id: `usePrice:${product.id}` })
            : intentButton(`lastPrice:${product.id}`, pending, "Check last paid price", { label: `Check last paid price for ${product.sku}` })}
        </div>
      </div>
      {received === 0 && intentButton(`remove:${product.id}`, pending, "Remove", { label: `Remove ${product.sku}` })}
    </div>
    <details className={styles.lineDetail} open={detail || undefined}>
      <summary>{supplierPart || note ? "Edit detail" : "Add detail"}</summary>
      <div className={styles.lineExtra}>
        <AdminField label="Supplier part number (optional)">
          <input id={`part:${product.id}`} name={`part:${product.id}`} maxLength={maxPartNumberLength}
            defaultValue={supplierPart} {...invalidField(state, `part:${product.id}`)} />
        </AdminField>
        <AdminField label="Line note (optional)">
          <textarea id={`note:${product.id}`} name={`note:${product.id}`} rows={2} maxLength={maxNoteLength}
            defaultValue={note} {...invalidField(state, `note:${product.id}`)} />
        </AdminField>
        <p className="admin-muted">The supplier copy includes this part number and line note.</p>
      </div>
    </details>
  </li>;
}
