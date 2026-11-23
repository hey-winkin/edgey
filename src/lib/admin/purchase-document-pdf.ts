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
const sans = "Inter";
const mono = "IBMPlexMono";

const fonts = [
  { family: sans, style: "normal", name: "Inter-Regular", subset: "EDGEAA" },
  { family: sans, style: "bold", name: "Inter-Bold", subset: "EDGEAB" },
  { family: mono, style: "normal", name: "IBMPlexMono-Regular", subset: "EDGEAC" },
  { family: mono, style: "bold", name: "IBMPlexMono-Bold", subset: "EDGEAD" },
] as const;

function readAssets() {
  return Promise.all([
    readFile(join(process.cwd(), "src/lib/admin/purchase-wordmark.png")),
    readFile(join(process.cwd(), "src/lib/admin/purchase-fonts/inter/Inter-Regular.ttf")),
    readFile(join(process.cwd(), "src/lib/admin/purchase-fonts/inter/Inter-Bold.ttf")),
    readFile(join(process.cwd(), "src/lib/admin/purchase-fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf")),
    readFile(join(process.cwd(), "src/lib/admin/purchase-fonts/ibm-plex-mono/IBMPlexMono-Bold.ttf")),
  ] as const);
}

let assets: ReturnType<typeof readAssets> | undefined;

export class UnsupportedPurchaseDocumentTextError extends Error {}

export async function purchaseDocumentPdf(order: PurchaseDocument) {
  const [logo, ...fontBytes] = await (assets ??= readAssets());
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true, putOnlyUsedFonts: true }) as
    jsPDF & { lastAutoTable?: Table };
  fonts.forEach(({ family, style, name }, index) => {
    const file = `${name}.ttf`;
    doc.addFileToVFS(file, fontBytes[index]!.toString("base64"));
    doc.addFont(file, family, style, undefined, "Identity-H");
  });
  const glyphs = {
    [sans]: doc.setFont(sans, "normal").getFont().metadata as { characterToGlyph: (code: number) => number },
    [mono]: doc.setFont(mono, "normal").getFont().metadata as { characterToGlyph: (code: number) => number },
  };
  const textCell = (value: string, preferred: typeof sans | typeof mono = sans) => {
    const content = value.normalize("NFC").replace(/\r\n?/g, "\n").replaceAll("\t", " ");
    for (const font of [preferred, preferred === sans ? mono : sans] as const) {
      if ([...content].every((char) => char === "\n" || (char.length === 1 && glyphs[font].characterToGlyph(char.charCodeAt(0))))) {
        return { content, styles: { font } };
      }
    }
    throw new UnsupportedPurchaseDocumentTextError("The PDF fonts cannot display all the characters in this order.");
  };
  doc.setProperties({ title: `Purchase order ${order.number}`, author: "Edgey" });
  doc.setLanguage("en-GB");

  const right = doc.internal.pageSize.getWidth() - margin;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  const width = right - margin;
  const pageMargins = { left: margin, right: margin, top: 90, bottom: 62 };
  const textStyles = { font: sans, fontSize: 10, textColor: ink, cellPadding: 6 } as const;
  const labelStyles = { font: mono, fontStyle: "normal", fontSize: 9, textColor: ink,
    lineColor: ink, lineWidth: { bottom: 0.75 } } as const;
  const money = (amount: bigint | number | null) =>
    amount === null ? "—" : formatPurchaseDocumentMoney(amount, order.currency);

  doc.addImage(logo, "PNG", margin, 37, 124, 124 * 141 / 400, "edgey");
  doc.setTextColor(ink).setFont(sans, "normal").setFontSize(26);
  doc.text("Purchase order", right, 62, { align: "right" });
  doc.setDrawColor(ink).setLineWidth(0.9).line(margin, 87, right, 87);

  let y = 109;
  const warning = purchaseDocumentWarning(order.status);
  if (warning) {
    doc.setFont(mono, "bold").setFontSize(10).text(warning, margin, y);
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
    const { content, styles } = textCell(value);
    doc.setTextColor(muted).setFont(mono, "normal").setFontSize(9).text(label.toUpperCase(), x, y);
    doc.setTextColor(ink).setFont(styles.font, "normal").setFontSize(12).text(content, x, y + 17);
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
      body: [parties.map(({ details }) => textCell(details.map(({ label, value }) =>
        label === "Name" || label === "Address" ? value : `${label}: ${value}`).join("\n")))],
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
  const monoCell = (value: string, cellWidth: number, minFontSize = 0) => {
    const { content, styles } = textCell(value, mono);
    const units = doc.setFont(styles.font, "normal").getStringUnitWidth(content);
    const available = cellWidth - 2 * textStyles.cellPadding - 1;
    return { content, styles: { ...styles, fontSize: Math.max(minFontSize, Math.min(9, available / units)) } };
  };
  autoTable(doc, {
    startY: y, margin: pageMargins, theme: "plain", showHead: "everyPage", showFoot: "lastPage",
    rowPageBreak: "avoid",
    styles: textStyles,
    headStyles: labelStyles,
    bodyStyles: { lineColor: rule, lineWidth: { bottom: 0.45 } },
    columnStyles: Object.fromEntries(columnWidths.map((cellWidth, index) => [index, {
      cellWidth,
      ...(index >= 3 ? { halign: "right" } : {}),
    }])),
    head: [
      [{ content: "ORDER LINES", colSpan: 6, styles: { cellPadding: { top: 6, bottom: 9, left: 6, right: 6 } } }],
      ["Edgey SKU", "Blade", "Supplier part", "Qty", "Unit price\nex VAT", "Line total\nex VAT"].map((content, index) =>
        ({ content, styles: { halign: index >= 3 ? "right" : "left" } })),
    ],
    body: order.lines.length ? order.lines.map((line) => [
      monoCell(line.sku, skuWidth, 7.5),
      textCell([line.name, line.option, line.note].filter(Boolean).join("\n")),
      monoCell(line.partNumber ?? "", partWidth, 7.5), monoCell(String(line.quantity), quantityWidth),
      monoCell(money(line.unitPriceMinor), priceWidth), monoCell(money(lineMerchandiseMinor(line)), lineTotalWidth),
    ]) : [[{ content: "No lines on this order.", colSpan: 6 }]],
    foot: [
      [
        { content: "Merchandise total", colSpan: 3, styles: { fontStyle: "bold", fontSize: 12 } },
        { content: total === null ? "Not available" : money(total), colSpan: 3,
          styles: { font: mono, fontStyle: "bold", fontSize: 12, halign: "right" } },
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
      doc.setTextColor(ink).setFont(sans, "normal").setFontSize(13);
      doc.text(`Purchase order / ${order.number}`, right, 53, { align: "right" });
      doc.setTextColor(muted).setFont(mono, "normal").setFontSize(9);
      doc.text(`Revision ${order.revision} / ${order.currency}`, right, 67, { align: "right" });
      if (warning) doc.setTextColor(ink).setFont(mono, "bold").text(warning, margin, 67);
      doc.line(margin, 76, right, 76);
    }
    doc.line(margin, bottom - 13, right, bottom - 13);
    doc.setTextColor(muted).setFont(mono, "normal").setFontSize(9);
    doc.text(`Page ${page} of ${pages}`, right, bottom, { align: "right" });
  }

  for (const { family, style, name, subset } of fonts) {
    doc.setFont(family, style).getFont().fontName = `${subset}+${name}`;
  }
  return doc.output("arraybuffer");
}
