import { describe, expect, it } from "vitest";
import {
  formatPurchaseDocumentMoney, lineMerchandiseMinor, purchaseDocumentCsv, purchaseDocumentDetails,
  totalMerchandiseMinor, type PurchaseDocument, type PurchaseDocumentLine,
} from "@/lib/admin/purchase-document";

const line: PurchaseDocumentLine = {
  variantId: "test-variant",
  sku: "TEST-01", name: 'Fixture blade, "round"', option: "5 mm", partNumber: "FIX-01",
  quantity: 3, unitPriceMinor: 1234, note: "Pack\nseparately",
};
const order: PurchaseDocument = {
  number: "PO-0987", revision: 2, status: "sent", orderedOn: "2026-11-22", expectedOn: null,
  currency: "USD",
  buyer: purchaseDocumentDetails([["Name", " Test Buyer "], ["Address", "   "], ["VAT number", null]]),
  supplier: purchaseDocumentDetails([["Name", "Test Supplier, Inc."], ["Address", "Unit 1\nTest Street"]]),
  lines: [line],
};

describe("supplier purchase order documents", () => {
  it("formats each supported currency and calculates merchandise in integer minor units", () => {
    expect(formatPurchaseDocumentMoney(123456, "GBP")).toBe("£1,234.56");
    expect(formatPurchaseDocumentMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatPurchaseDocumentMoney(123456, "EUR")).toBe("€1,234.56");
    expect(formatPurchaseDocumentMoney(0, "GBP")).toBe("£0.00");

    expect(lineMerchandiseMinor(line)).toBe(3702n);
    const largeLine = { ...line, quantity: 2_147_483_647, unitPriceMinor: 2_147_483_647 };
    expect(lineMerchandiseMinor(largeLine)).toBe(4_611_686_014_132_420_609n);
    expect(formatPurchaseDocumentMoney(lineMerchandiseMinor(largeLine)!, "USD")).toBe("$46,116,860,141,324,206.09");
    expect(totalMerchandiseMinor([line, largeLine])).toBe(4_611_686_014_132_424_311n);
  });

  it("exports the supplier-facing details and merchandise totals only", () => {
    const csv = purchaseDocumentCsv(order);
    expect(csv).toContain('"Purchase order","PO-0987",,,,,,\r\n');
    expect(csv).toContain('"Buyer name","Test Buyer",,,,,,\r\n');
    expect(csv).toContain('"Supplier name","Test Supplier, Inc.",,,,,,\r\n');
    expect(csv).toContain('"Supplier address","Unit 1\nTest Street",,,,,,\r\n');
    expect(csv).toContain('"Unit price ex VAT (USD)","Merchandise line total ex VAT (USD)"');
    expect(csv).toContain('"TEST-01","Fixture blade, ""round""","5 mm","FIX-01","Pack\nseparately",3,12.34,37.02\r\n');
    expect(csv).toContain('"Merchandise total",,,,,,,37.02\r\n');
    expect(csv).toContain("Merchandise prices and totals exclude VAT, shipping, duty and other charges.");
    expect(csv).not.toMatch(/Buyer address|Buyer VAT number|Expected on|Exchange rate|Landed cost|Document status/);
  });

  it.each(["=1+1", "+1+1", "-1+1", "@SUM(1)", "  \uFEFF=1", " \u200B@SUM(1)", " \u001F=1", "\tText", "\rText", "\nText", "＝1"])(
    "neutralises supplier-controlled spreadsheet text %j",
    (text) => {
      const csv = purchaseDocumentCsv({
        ...order, supplier: [{ label: "Contact", value: text }],
        lines: [{ ...line, sku: text, partNumber: text, note: text }],
      });
      const safe = `"'${text}"`;
      expect(csv).toContain(`"Supplier contact",${safe},,,,,,\r\n`);
      expect(csv).toContain(`${safe},"Fixture blade, ""round""","5 mm",${safe},${safe},3,12.34,37.02\r\n`);
    },
  );

  it("keeps unpriced draft values blank and does not misstate the merchandise total", () => {
    const lines = [...order.lines, { ...line, sku: "TEST-02", unitPriceMinor: null, note: null }];
    expect(totalMerchandiseMinor(lines)).toBeNull();
    expect(totalMerchandiseMinor([])).toBeNull();
    const csv = purchaseDocumentCsv({ ...order, lines, status: "draft" });
    expect(csv).toContain('"Document status","Draft — not issued"');
    expect(csv).toContain('"TEST-02","Fixture blade, ""round""","5 mm","FIX-01",,3,,\r\n');
    expect(csv).toContain('"Merchandise total not available",,,,,,,\r\n');
    expect(purchaseDocumentCsv({ ...order, status: "cancelled" })).toContain("Cancelled — do not fulfil");
  });
});
