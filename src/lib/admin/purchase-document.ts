export const purchaseDocumentCurrencies = ["GBP", "USD", "EUR"] as const;

export type PurchaseDocumentCurrency = (typeof purchaseDocumentCurrencies)[number];
export type PurchaseDocumentDetail = { label: string; value: string };
export type PurchaseDocumentLine = {
  variantId: string;
  sku: string;
  name: string;
  option: string | null;
  partNumber: string | null;
  note: string | null;
  quantity: number;
  unitPriceMinor: number | null;
};
export type PurchaseDocument = {
  number: string;
  revision: number;
  status: string;
  orderedOn: string;
  expectedOn: string | null;
  currency: PurchaseDocumentCurrency;
  buyer: PurchaseDocumentDetail[];
  supplier: PurchaseDocumentDetail[];
  lines: PurchaseDocumentLine[];
};

export const purchaseDocumentTerms = "Merchandise prices and totals exclude VAT, shipping, duty and other charges.";

const documentDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

export function formatPurchaseDocumentDate(value: string) {
  return documentDate.format(new Date(value));
}

export function purchaseDocumentWarning(status: string) {
  if (status === "draft") return "Draft — not issued";
  if (status === "cancelled") return "Cancelled — do not fulfil";
  return null;
}

export function purchaseDocumentDetails(details: ReadonlyArray<readonly [string, string | null | undefined]>) {
  return details.flatMap<PurchaseDocumentDetail>(([label, value]) => value?.trim() ? [{ label, value: value.trim() }] : []);
}

export function lineMerchandiseMinor({ quantity, unitPriceMinor }: PurchaseDocumentLine) {
  return unitPriceMinor === null ? null : BigInt(quantity) * BigInt(unitPriceMinor);
}

export function totalMerchandiseMinor(lines: PurchaseDocumentLine[]) {
  if (!lines.length) return null;
  let total = 0n;
  for (const line of lines) {
    const amount = lineMerchandiseMinor(line);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

export function formatPurchaseDocumentMoney(minor: bigint | number, currency: PurchaseDocumentCurrency) {
  const amount = BigInt(minor);
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
    .formatToParts(amount / 100n)
    .map(({ type, value }) => type === "fraction" ? String(amount % 100n).padStart(2, "0") : value)
    .join("");
}

type CsvCell = string | number | null | { minor: bigint | number };

function csvField(value: CsvCell) {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const minor = BigInt(value.minor);
    return `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;
  }
  const safe = /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]|^\p{Cc}/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function purchaseDocumentCsv(document: PurchaseDocument) {
  const total = totalMerchandiseMinor(document.lines);
  const warning = purchaseDocumentWarning(document.status);
  const rows: CsvCell[][] = [
    ["Purchase order", document.number],
    ["Revision", document.revision],
    ...(warning ? [["Document status", warning]] : []),
    ["Ordered on", document.orderedOn],
    ...(document.expectedOn ? [["Expected on", document.expectedOn]] : []),
    ["Currency", document.currency],
    ...document.buyer.map(({ label, value }) => [`Buyer ${label.toLowerCase()}`, value]),
    ...document.supplier.map(({ label, value }) => [`Supplier ${label.toLowerCase()}`, value]),
    ["Terms", purchaseDocumentTerms],
    [],
    ["SKU", "Blade", "Option", "Supplier part number", "Line note", "Quantity",
      `Unit price ex VAT (${document.currency})`, `Merchandise line total ex VAT (${document.currency})`],
    ...document.lines.map((line) => {
      const total = lineMerchandiseMinor(line);
      return [line.sku, line.name, line.option, line.partNumber, line.note, line.quantity,
        line.unitPriceMinor === null ? null : { minor: line.unitPriceMinor },
        total === null ? null : { minor: total }];
    }),
    [total === null ? "Merchandise total not available" : "Merchandise total", null, null, null, null, null, null,
      total === null ? null : { minor: total }],
  ];
  return rows.map((row) => Array.from({ length: 8 }, (_, index) => csvField(row[index] ?? null)).join(",")).join("\r\n") + "\r\n";
}
