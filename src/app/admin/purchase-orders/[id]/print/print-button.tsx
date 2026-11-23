"use client";

export function PrintPurchaseOrderButton() {
  return <button type="button" className="primary" onClick={() => window.print()}>Print purchase order</button>;
}
