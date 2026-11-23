import { Buffer } from "node:buffer";

const variantId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const uuidBytes = 16;
export const stockSelectionLimit = 200;

export function encodeStockSelection(ids: readonly string[]) {
  const values = new Set<string>();
  for (const id of ids) {
    if (variantId.test(id)) values.add(id.replaceAll("-", "").toLowerCase());
    if (values.size === stockSelectionLimit) break;
  }
  return Buffer.from([...values].join(""), "hex").toString("base64url");
}

export function decodeStockSelection(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length > Math.ceil(stockSelectionLimit * uuidBytes * 4 / 3) ||
      !/^[A-Za-z0-9_-]+$/.test(raw)) return [];
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length % uuidBytes !== 0 || bytes.toString("base64url") !== raw) return [];
  const ids = new Set<string>();
  for (let start = 0; start < bytes.length; start += uuidBytes) {
    const hex = bytes.toString("hex", start, start + uuidBytes);
    ids.add(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
  }
  return [...ids];
}
