"use client";

import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import { orderStockLabel } from "@/lib/admin/navigation";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function StockSelectionForm({ action, filters, hasFilters, notice, offPageCount, initialVisibleCount, pageSize, canSelectMatching,
  children }: {
  action: (form: FormData) => Promise<void>;
  filters: ReactNode;
  hasFilters: boolean;
  notice: ReactNode;
  offPageCount: number;
  initialVisibleCount: number;
  pageSize: number;
  canSelectMatching: boolean;
  children: ReactNode;
}) {
  const enhanced = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount);
  const count = offPageCount + visibleCount;
  const allVisible = pageSize > 0 && visibleCount === pageSize;
  const mixed = visibleCount > 0 && !allVisible;

  const updateVisibleCount = useCallback((form: HTMLFormElement | null) => {
    if (form) setVisibleCount(form.querySelectorAll('input[name="variant"]:checked').length);
  }, []);

  return (
    <form ref={updateVisibleCount} className="catalogue-list-form" action={action} data-off-page={offPageCount > 0 || undefined}
      data-enhanced={enhanced || undefined}
      onChange={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.name === "variant") {
          updateVisibleCount(event.currentTarget);
        }
      }} onReset={() => setVisibleCount(initialVisibleCount)}>
      <div className="catalogue-list-filters" role="search" aria-label="Stock filters">
        {filters}
        <div className="catalogue-list-filter-actions">
          <button type="submit" name="intent" value="filter" className="secondary">Apply filters</button>
          {hasFilters && <button type="submit" name="intent" value="clear-filters" className="catalogue-list-text-button">Clear filters</button>}
        </div>
      </div>
      <p id="stock-results" tabIndex={-1} className="catalogue-list-summary admin-muted">
        Available stock excludes reservations. Prices are per blade, ex VAT.
      </p>
      {notice}
      {(pageSize > 0 || offPageCount > 0 || canSelectMatching) && (
        <div className="catalogue-list-selection">
          {pageSize > 0 && (enhanced ? (
            <label className="catalogue-list-check catalogue-list-master">
              <input type="checkbox" checked={allVisible} ref={(input) => { if (input) input.indeterminate = mixed; }}
                onChange={(event) => {
                  const { form, checked } = event.currentTarget;
                  if (!form) return;
                  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="variant"]')) {
                    input.checked = checked;
                  }
                  updateVisibleCount(form);
                }} />
              <span>Select all on this page</span>
            </label>
          ) : (
            <button type="submit" className="catalogue-list-text-button" name="intent" value={allVisible ? "clear-page" : "select-page"}>
              {allVisible ? "Deselect this page" : "Select this page"}
            </button>
          ))}
          {canSelectMatching && <button type="submit" className="catalogue-list-text-button catalogue-list-select-matching" name="intent" value="select-matching">
            Select all matching blades
          </button>}
          <div className="catalogue-list-order">
            <p className="admin-muted" role="status">{count > 0 ? `${count} ${count === 1 ? "blade" : "blades"} selected` :
              <span className="sr">No blades selected</span>}</p>
            <button type="submit" className="catalogue-list-text-button" name="intent" value="clear-selection">Clear selection</button>
            <button type="submit" className="primary" name="intent" value="order">{orderStockLabel}</button>
          </div>
        </div>
      )}
      {children}
    </form>
  );
}
