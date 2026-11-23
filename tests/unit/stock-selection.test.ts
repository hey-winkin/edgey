import { expect, test } from "vitest";
import { decodeStockSelection, encodeStockSelection, stockSelectionLimit } from "@/lib/admin/stock-selection";

const first = "e221a246-9fd8-41dd-9c12-9ad6d636ec19";
const second = "47c77788-f7f5-4910-a1ce-7b5adc3df72c";

test("packs canonical IDs in selection order without duplicates", () => {
  const token = encodeStockSelection([second, first.toUpperCase(), second, "not-an-id"]);
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(decodeStockSelection(token)).toEqual([second, first]);
});

test("rejects malformed or ambiguous tokens", () => {
  const token = encodeStockSelection([first]);
  for (const invalid of [undefined, [token], "", token.slice(1), token + "=", "a".repeat(5000)]) {
    expect(decodeStockSelection(invalid)).toEqual([]);
  }
});

test("supports the purchase line limit in a bounded URL token", () => {
  const ids = Array.from({ length: stockSelectionLimit + 2 }, (_, index) =>
    `00000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}`);
  const token = encodeStockSelection(ids);
  expect(token).toHaveLength(4267);
  expect(decodeStockSelection(token)).toEqual(ids.slice(0, stockSelectionLimit));
});
