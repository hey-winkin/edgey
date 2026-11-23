import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdminLink } from "@/app/admin/ui";
import { Wordmark } from "@/components/wordmark";
import { requireStaff } from "@/lib/admin/auth";
import { readPurchaseDocument } from "@/lib/admin/purchase-document-data";
import {
  formatPurchaseDocumentDate, formatPurchaseDocumentMoney, lineMerchandiseMinor, purchaseDocumentTerms,
  purchaseDocumentWarning, totalMerchandiseMinor, type PurchaseDocumentDetail,
} from "@/lib/admin/purchase-document";
import { PrintPurchaseOrderButton } from "./print-button";
import "./print.css";

export const metadata: Metadata = { title: "Print purchase order" };

function PartyDetails({ title, details }: { title: string; details: PurchaseDocumentDetail[] }) {
  if (!details.length) return null;
  return (
    <section className="po-document-party">
      <h2>{title}</h2>
      <dl className="admin-spec">
        {details.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="whitespace-pre-wrap">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function PrintPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await requireStaff("catalogue", "finance");
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const order = await readPurchaseDocument(db, id);
  if (!order) notFound();

  const warning = purchaseDocumentWarning(order.status);
  const total = totalMerchandiseMinor(order.lines);

  return (
    <>
      <nav className="mt-4 flex flex-wrap items-center gap-4" aria-label="Purchase order document controls">
        <AdminLink href="/admin/purchase-orders">Back to purchase orders</AdminLink>
        <AdminLink href={`/admin/purchase-orders/${id}`}>Back to order</AdminLink>
        <a className="textlink" href={`/admin/purchase-orders/${id}/export`}>Download CSV</a>
        <a className="textlink" href={`/admin/purchase-orders/${id}/export/pdf`}>Download PDF</a>
        <PrintPurchaseOrderButton />
        <p className="admin-muted basis-full">This uses the current buyer and supplier details. Save a copy of what you send.</p>
      </nav>
      <article className="po-document">
        <header className="po-document-masthead">
          <div className="po-document-brand" role="img" aria-label="Edgey"><Wordmark /></div>
          <h1>Purchase order</h1>
        </header>
        {warning && <p className="po-document-warning admin-mono">{warning}</p>}
        <dl className="po-document-reference">
          <div><dt>Order number</dt><dd>{order.number}</dd></div>
          <div><dt>Revision</dt><dd>{order.revision}</dd></div>
          <div><dt>Ordered on</dt><dd>{formatPurchaseDocumentDate(order.orderedOn)}</dd></div>
          {order.expectedOn && <div><dt>Expected on</dt><dd>{formatPurchaseDocumentDate(order.expectedOn)}</dd></div>}
          <div><dt>Currency</dt><dd>{order.currency}</dd></div>
        </dl>
        {(order.buyer.length > 0 || order.supplier.length > 0) && (
          <div className="po-document-parties">
            <PartyDetails title="Buyer" details={order.buyer} />
            <PartyDetails title="Supplier" details={order.supplier} />
          </div>
        )}
        <section>
          <h2 id="po-document-items">Order lines</h2>
          {order.lines.length ? (
            <div className="admin-table-scroll" role="region" aria-labelledby="po-document-items" tabIndex={0}>
              <table className="admin-table po-document-table" aria-labelledby="po-document-items">
                <thead>
                  <tr>
                    <th scope="col">Edgey SKU</th>
                    <th scope="col">Blade</th>
                    <th scope="col">Supplier part</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Unit price ex VAT</th>
                    <th scope="col">Line total ex VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => {
                    const lineTotal = lineMerchandiseMinor(line);
                    return (
                      <tr key={line.variantId}>
                        <td className="admin-mono">{line.sku}</td>
                        <td>
                          {line.name}
                          {line.option && <div className="admin-muted">{line.option}</div>}
                          {line.note && <div className="po-document-line-note whitespace-pre-wrap">{line.note}</div>}
                        </td>
                        <td className="admin-mono">{line.partNumber}</td>
                        <td className="admin-mono">{line.quantity}</td>
                        <td className="admin-mono">{line.unitPriceMinor === null ? "—" :
                          formatPurchaseDocumentMoney(line.unitPriceMinor, order.currency)}</td>
                        <td className="admin-mono">{lineTotal === null ? "—" :
                          formatPurchaseDocumentMoney(lineTotal, order.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p>No lines on this order.</p>}
          <div className="po-document-summary">
            <p><strong>Merchandise total</strong></p>
            <p className="admin-mono">{total === null ? "Not available" : formatPurchaseDocumentMoney(total, order.currency)}</p>
            <p className="po-document-terms admin-muted">{purchaseDocumentTerms}</p>
          </div>
        </section>
      </article>
    </>
  );
}
