import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/admin/purchase-orders/[id]/export/pdf/route";
import { staffSession } from "@/lib/admin/auth";
import { readPurchaseDocument } from "@/lib/admin/purchase-document-data";
import { purchaseDocumentPdf } from "@/lib/admin/purchase-document-pdf";
import {
  purchaseDocumentDetails, purchaseDocumentTerms, type PurchaseDocument, type PurchaseDocumentLine,
} from "@/lib/admin/purchase-document";

vi.mock("@/lib/admin/auth", () => ({ staffSession: vi.fn() }));
vi.mock("@/lib/admin/purchase-document-data", () => ({ readPurchaseDocument: vi.fn() }));
vi.mock("server-only", () => ({}));

const line = {
  variantId: "PRIVATE-VARIANT-KEY",
  sku: "TEST-01", name: "Invented oscillating blade", option: "60° tip · 40 mm",
  partNumber: "SUP-001", quantity: 3, unitPriceMinor: 1234, note: "Pack by SKU.\nLabel each box.",
  landedUnitPence: 98123, margin: "PRIVATE-LINE-MARGIN",
} satisfies PurchaseDocumentLine & { landedUnitPence: number; margin: string };
const order = {
  number: "PO-0987", revision: 2, status: "sent", orderedOn: "2026-11-22", expectedOn: "2026-12-09",
  currency: "EUR",
  buyer: purchaseDocumentDetails([
    ["Name", "Example buyer Ltd"], ["Address", "8 Fiction Road\nExample City"],
    ["Email", "orders@example.test"], ["Company number", "00001234"], ["VAT number", "GB012345678"],
  ]),
  supplier: purchaseDocumentDetails([
    ["Name", "Café Fixture Tooling"], ["Contact", "Hélène Example"], ["Address", "85 Sample Road\nFiction Town"],
    ["Email", "supplier@example.test"], ["Phone", "+44 0000 000000"],
  ]),
  lines: [line],
  note: "PRIVATE-ORDER-NOTE", exchangeRate: "PRIVATE-EXCHANGE-RATE", shippingMinor: 66533,
} satisfies PurchaseDocument & { note: string; exchangeRate: string; shippingMinor: number };

function pdfText(bytes: ArrayBuffer) {
  return extractText(new Uint8Array(bytes));
}

const oneLine = (text: string) => text.replace(/\s+/g, " ");

describe("purchase order PDF", () => {
  it("renders the supplier-facing field list, exact currency amounts and A4 paper", async () => {
    const bytes = await purchaseDocumentPdf(order);
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const page = await pdf.getPage(1);
    expect(page.getViewport({ scale: 1 }).width).toBeCloseTo(595.28);
    expect(page.getViewport({ scale: 1 }).height).toBeCloseTo(841.89);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    expect(totalPages).toBe(1);
    const contents = oneLine(text);
    for (const field of [
      "Purchase order", "PO-0987", "REVISION 2", "22 Nov 2026", "9 Dec 2026", "EUR",
      "Example buyer Ltd", "8 Fiction Road", "Example City", "orders@example.test", "Company number: 00001234",
      "VAT number: GB012345678", "Café Fixture Tooling", "Hélène Example", "85 Sample Road", "Fiction Town",
      "supplier@example.test", "+44 0000 000000", "Edgey SKU", "Blade", "Supplier part", "Qty", "Unit price ex VAT",
      "Line total ex VAT", "TEST-01", "Invented oscillating blade", "60° tip · 40 mm", "SUP-001",
      "Pack by SKU.", "Label each box.", "3 €12.34 €37.02", "Merchandise total €37.02", purchaseDocumentTerms,
      "Page 1 of 1",
    ]) expect(contents).toContain(field);
    expect(contents).not.toMatch(/PRIVATE-|98,123|981\.23|665\.33|exchange rate|landed cost|margin/i);
  });

  it("omits missing business details and does not claim a total on an unpriced draft", async () => {
    const { text, totalPages } = await pdfText(await purchaseDocumentPdf({
      ...order, status: "draft", expectedOn: null,
      buyer: purchaseDocumentDetails([["Address", " "], ["Company number", null], ["VAT number", undefined]]),
      lines: [{ ...line, unitPriceMinor: null }],
    }));
    expect(totalPages).toBe(1);
    expect(text[0]).toContain("Draft — not issued");
    expect(text[0]).toContain("Merchandise total Not available");
    expect(text[0]).toContain("Café Fixture Tooling");
    expect(text[0]).not.toMatch(/BUYER|Company number|VAT number|EXPECTED ON/i);
  });

  it("repeats column headers, includes every line once and counts pages", async () => {
    const lines = Array.from({ length: 79 }, (_, index) => ({
      ...line, sku: `FIXTURE-${String(index + 1).padStart(3, "0")}`, partNumber: `SUP-${index + 1}`,
      note: index % 4 === 0 ? `Pack blade ${index + 1} in its own sleeve.\nKeep the tip away from the edge of the carton.` : null,
    }));
    const { text, totalPages } = await pdfText(await purchaseDocumentPdf({ ...order, lines }));

    expect(totalPages).toBeGreaterThan(2);
    expect(text.join(" ").match(/FIXTURE-\d{3}/g)).toEqual(lines.map(({ sku }) => sku));
    text.forEach((page, index) => {
      expect(page).toContain("Edgey SKU");
      expect(oneLine(page)).toContain("Line total ex VAT");
      expect(page).toContain(`Page ${index + 1} of ${totalPages}`);
      if (index < totalPages - 1) expect(page).not.toContain("Merchandise total");
    });
    expect(oneLine(text.at(-1)!)).toContain("Merchandise total €2,924.58");
  });

  it("preserves a note taller than a page and the exact large line total", async () => {
    const noteLines = Array.from({ length: 76 }, (_, index) => `N-${String(index + 1).padStart(2, "0")}`);
    const { text, totalPages } = await pdfText(await purchaseDocumentPdf({
      ...order, status: "cancelled",
      lines: [{ ...line, note: noteLines.join("\n"), quantity: 2_147_483_647, unitPriceMinor: 2_147_483_647 }],
    }));
    expect(totalPages).toBeGreaterThan(1);
    expect(text[0]).toContain("Cancelled — do not fulfil");
    expect(text.at(-1)).toContain("Cancelled — do not fulfil");
    expect(text.at(-1)).toContain("Revision 2 / EUR");
    expect(text.join(" ").match(/N-\d{2}/g)).toEqual(noteLines);
    expect(text.join(" ")).toContain("€46,116,860,141,324,206.09");
  });
});

describe("purchase order PDF download", () => {
  const id = "24bc906b-7c17-4142-a586-594d7eb9f84b";
  const request = (requestedId = id) => GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: requestedId }),
  });
  const db = {} as NonNullable<Awaited<ReturnType<typeof staffSession>>>["db"];

  it.each([["catalogue"], ["finance"]] as const)("serves a private PDF attachment to %s", async (role) => {
    vi.mocked(staffSession).mockResolvedValue({ db, roles: [role] } as NonNullable<Awaited<ReturnType<typeof staffSession>>>);
    vi.mocked(readPurchaseDocument).mockResolvedValue(order);
    const response = await request();
    expect(readPurchaseDocument).toHaveBeenCalledWith(db, id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="PO-0987.pdf"');
    expect((await response.text()).slice(0, 5)).toBe("%PDF-");
  });

  it("refuses warehouse and unsigned users before reading the order", async () => {
    vi.mocked(readPurchaseDocument).mockClear();
    vi.mocked(staffSession).mockResolvedValueOnce({ db, roles: ["warehouse"] } as NonNullable<Awaited<ReturnType<typeof staffSession>>>)
      .mockResolvedValueOnce(null);
    expect((await request()).status).toBe(403);
    expect((await request()).status).toBe(403);
    expect(readPurchaseDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for an invalid or absent order", async () => {
    vi.mocked(readPurchaseDocument).mockClear().mockResolvedValue(null);
    vi.mocked(staffSession).mockResolvedValue({ db, roles: ["finance"] } as NonNullable<Awaited<ReturnType<typeof staffSession>>>);
    expect((await request("not-an-id")).status).toBe(404);
    expect(readPurchaseDocument).not.toHaveBeenCalled();
    expect((await request()).status).toBe(404);
  });

  it("offers the Unicode-capable printable copy and CSV instead of altering supplier text", async () => {
    vi.mocked(staffSession).mockResolvedValue({ db, roles: ["finance"] } as NonNullable<Awaited<ReturnType<typeof staffSession>>>);
    vi.mocked(readPurchaseDocument).mockResolvedValue({
      ...order, supplier: [{ label: "Address", value: "Łódź / 仮の住所" }],
    });
    const response = await request();
    expect(response.status).toBe(422);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.has("Content-Disposition")).toBe(false);
    const html = await response.text();
    expect(html).toContain("Save as PDF");
    const base = `http://localhost/admin/purchase-orders/${id}`;
    expect([...html.matchAll(/href="([^"]+)"/g)].map(([, href]) => new URL(href!, base + "/export/pdf").href))
      .toEqual([base + "/print", base + "/export"]);
    expect(html).not.toMatch(/Łódź|仮の住所/);
  });
});
