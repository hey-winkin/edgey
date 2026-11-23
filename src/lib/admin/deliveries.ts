import { parsePoundsToPence } from "./pounds";

export const MAX_DELIVERY_ROWS = 200;
export const MAX_DELIVERY_CODE_LENGTH = 120;
export const MAX_DELIVERY_IMPORT_BYTES = 128 * 1024;
export const DELIVERY_QUANTITY_MAX = 2_147_483_647;

export type DeliveryMatch = { inputCode: string; variantId: string; sku: string; bladeName: string };
export type ImportedDeliveryRow = { sourceRow: number; code: string; quantity: string; unitCost: string };
export type DeliveryCommitInput = {
  id: string;
  reference: string;
  receivedOn: string;
  note: string;
  lines: { variantId: string; quantity: number; unitCostPence: number | null }[];
};

export function parseDeliveryQuantity(value: string) {
  const text = value.trim();
  if (!/^\d{1,10}$/.test(text)) return null;
  const quantity = Number(text);
  return quantity > 0 && quantity <= DELIVERY_QUANTITY_MAX ? quantity : null;
}

export function parseDeliveryCost(value: string) {
  return parsePoundsToPence(value.trim().replace(/^£\s*/, ""));
}

export function hasDeliveryControlCharacters(value: string) {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});

export function deliveryToday() {
  return londonDate.format(new Date());
}

export function isDeliveryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") || value > deliveryToday()) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
