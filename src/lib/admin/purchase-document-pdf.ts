import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { autoTable, type Table } from "jspdf-autotable";
import {
  formatPurchaseDocumentDate, formatPurchaseDocumentMoney, lineMerchandiseMinor, purchaseDocumentTerms,
  purchaseDocumentWarning, totalMerchandiseMinor, type PurchaseDocument,
} from "./purchase-document";

const ink = "#232627";
const muted = "#5B605E";
const rule = "#D1D3CD";
const margin = 40;

export class UnsupportedPurchaseDocumentTextError extends Error {}

function printText(value: string) {
  const text = value.normalize("NFC").replace(/\r\n?/g, "\n").replaceAll("\t", " ");
  if (/[^\n\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/u.test(text)) {
    throw new UnsupportedPurchaseDocumentTextError("The PDF fonts cannot display all the characters in this order.");
  }
  return text;
}

export async function purchaseDocumentPdf(order: PurchaseDocument) {
  const logo = await readFile(join(process.cwd(), "src/lib/admin/purchase-wordmark.png"));
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true, putOnlyUsedFonts: true }) as
    jsPDF & { lastAutoTable?: Table };
  doc.setProperties({ title: `Purchase order ${order.number}`, author: "Edgey" });
  doc.setLanguage("en-GB");

  const right = doc.internal.pageSize.getWidth() - margin;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  const width = right - margin;
  const pageMargins = { left: margin, right: margin, top: 90, bottom: 62 };
  const textStyles = { font: "helvetica", fontSize: 10, textColor: ink, cellPadding: 6 } as const;
  const labelStyles = { font: "courier", fontStyle: "normal", fontSize: 9, textColor: ink,
    lineColor: ink, lineWidth: { bottom: 0.75 } } as const;
  const money = (amount: bigint | number | null) =>
    amount === null ? "—" : formatPurchaseDocumentMoney(amount, order.currency);

  doc.addImage(logo, "PNG", margin, 37, 124, 124 * 141 / 400, "edgey");
  doc.setTextColor(ink).setFont("helvetica", "normal").setFontSize(26);
  doc.text("Purchase order", right, 62, { align: "right" });
  doc.setDrawColor(ink).setLineWidth(0.9).line(margin, 87, right, 87);

  let y = 109;
  const warning = purchaseDocumentWarning(order.status);
  if (warning) {
    doc.setFont("courier", "bold").setFontSize(10).text(warning, margin, y);
    y += 23;
  }
  const references: [string, string][] = [
    ["Order number", order.number], ["Revision", String(order.revision)],
    ["Ordered on", formatPurchaseDocumentDate(order.orderedOn)],
  ];
  if (order.expectedOn) references.push(["Expected on", formatPurchaseDocumentDate(order.expectedOn)]);
  references.push(["Currency", order.currency]);
  references.forEach(([label, value], index) => {
    const x = margin + width * index / references.length;
    doc.setTextColor(muted).setFont("courier", "normal").setFontSize(9).text(label.toUpperCase(), x, y);
    doc.setTextColor(ink).setFont("helvetica", "normal").setFontSize(12).text(printText(value), x, y + 17);
  });
  y += 32;

  const parties = [
    { title: "Buyer", details: order.buyer },
    { title: "Supplier", details: order.supplier },
  ].filter(({ details }) => details.length);
  if (parties.length) {
    autoTable(doc, {
      startY: y, margin: pageMargins, theme: "plain",
      styles: textStyles, headStyles: labelStyles,
      columnStyles: Object.fromEntries(parties.map((_, index) => [index, { cellWidth: width / parties.length }])),
      head: [parties.map(({ title }) => title.toUpperCase())],
      body: [parties.map(({ details }) => details.map(({ label, value }) =>
        printText(label === "Name" || label === "Address" ? value : `${label}: ${value}`)).join("\n"))],
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 22;
  }

  const total = totalMerchandiseMinor(order.lines);
  const skuWidth = 78;
  const partWidth = 83;
  const quantityWidth = 42;
  const priceWidth = 70;
  const lineTotalWidth = 111;
  const columnWidths = [skuWidth, width - skuWidth - partWidth - quantityWidth - priceWidth - lineTotalWidth, partWidth,
    quantityWidth, priceWidth, lineTotalWidth];
  const monoCell = (content: string, cellWidth: number, minFontSize = 0) => ({
    content,
    styles: { fontSize: Math.max(minFontSize, Math.min(9, (cellWidth - 2 * textStyles.cellPadding - 1) / (0.6 * content.length))) },
  });
  autoTable(doc, {
    startY: y, margin: pageMargins, theme: "plain", showHead: "everyPage", showFoot: "lastPage",
    rowPageBreak: "avoid",
    styles: textStyles,
    headStyles: labelStyles,
    bodyStyles: { lineColor: rule, lineWidth: { bottom: 0.45 } },
    columnStyles: Object.fromEntries(columnWidths.map((cellWidth, index) => [index, {
      cellWidth, ...(index !== 1 ? { font: "courier", fontSize: 9 } : {}),
      ...(index >= 3 ? { halign: "right" } : {}),
    }])),
    head: [
      [{ content: "ORDER LINES", colSpan: 6, styles: { cellPadding: { top: 6, bottom: 9, left: 6, right: 6 } } }],
      ["Edgey SKU", "Blade", "Supplier part", "Qty", "Unit price\nex VAT", "Line total\nex VAT"].map((content, index) =>
        ({ content, styles: { halign: index >= 3 ? "right" : "left" } })),
    ],
    body: order.lines.length ? order.lines.map((line) => [
      monoCell(printText(line.sku), skuWidth, 7.5),
      [line.name, line.option, line.note].filter((value): value is string => Boolean(value)).map(printText).join("\n"),
      monoCell(printText(line.partNumber ?? ""), partWidth, 7.5), monoCell(String(line.quantity), quantityWidth),
      monoCell(money(line.unitPriceMinor), priceWidth), monoCell(money(lineMerchandiseMinor(line)), lineTotalWidth),
    ]) : [[{ content: "No lines on this order.", colSpan: 6 }]],
    foot: [
      [
        { content: "Merchandise total", colSpan: 3, styles: { fontStyle: "bold", fontSize: 12 } },
        { content: total === null ? "Not available" : money(total), colSpan: 3,
          styles: { font: "courier", fontStyle: "bold", fontSize: 12, halign: "right" } },
      ],
      [{ content: purchaseDocumentTerms, colSpan: 6, styles: { fontSize: 9, fontStyle: "normal", textColor: muted } }],
    ],
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(ink).setLineWidth(0.75);
    if (page > 1) {
      doc.addImage(logo, "PNG", margin, 33, 82, 82 * 141 / 400, "edgey");
      doc.setTextColor(ink).setFont("helvetica", "normal").setFontSize(13);
      doc.text(`Purchase order / ${printText(order.number)}`, right, 53, { align: "right" });
      doc.setTextColor(muted).setFont("courier", "normal").setFontSize(9);
      doc.text(`Revision ${order.revision} / ${order.currency}`, right, 67, { align: "right" });
      if (warning) doc.setTextColor(ink).setFont("courier", "bold").text(warning, margin, 67);
      doc.line(margin, 76, right, 76);
    }
    doc.line(margin, bottom - 13, right, bottom - 13);
    doc.setTextColor(muted).setFont("courier", "normal").setFontSize(9);
    doc.text(`Page ${page} of ${pages}`, right, bottom, { align: "right" });
  }

  return doc.output("arraybuffer");
}
