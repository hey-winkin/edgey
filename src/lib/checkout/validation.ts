import { isPositiveQuantity, parseUkPostcode, type LineRequest } from "@/lib/commerce";
import type { CheckoutFields } from "./types";

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const versionFourUuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;
const controls = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const emailPattern = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export const MAX_ORDER_INTEGER = 2_147_483_647;
export const MAX_BASKET_LINES = 100;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseUuid(value: unknown) {
  if (typeof value !== "string" || value.length > 40) return null;
  const trimmed = value.trim();
  return uuid.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function readPostcodeInput(value: unknown) {
  return typeof value === "string" && value.length <= 32 && !controls.test(value) ? value.trim() : null;
}

export function normaliseAttemptToken(value: unknown) {
  const token = normaliseUuid(value);
  return token && versionFourUuid.test(token) ? token : null;
}

export function normaliseLines(input: unknown): LineRequest[] | null {
  if (!Array.isArray(input) || input.length > MAX_BASKET_LINES) return null;
  const quantities = new Map<string, number>();
  for (const line of input) {
    if (!isRecord(line) || !isPositiveQuantity(line.quantity)) return null;
    const variantId = normaliseUuid(line.variantId);
    if (!variantId) return null;
    const quantity = (quantities.get(variantId) ?? 0) + line.quantity;
    if (quantity > MAX_ORDER_INTEGER) return null;
    quantities.set(variantId, quantity);
  }
  return [...quantities].map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function validateCheckoutFields(input: unknown) {
  const fields = isRecord(input) ? input : {};
  const errors: Partial<Record<keyof CheckoutFields, string>> = {};

  function text(
    key: "businessName" | "recipientName" | "line1" | "line2" | "town" | "region",
    label: string,
    max: number,
    required = true,
  ) {
    const raw = fields[key];
    if (raw === undefined && !required) return "";
    if (typeof raw !== "string" || raw.length > max || controls.test(raw)) {
      errors[key] = `Enter ${label} using no more than ${max} characters on one line.`;
      return "";
    }
    const value = raw.trim().normalize("NFC").replace(/\s+/g, " ");
    if (value.length > max) errors[key] = `Enter ${label} using no more than ${max} characters.`;
    if (!value && required) errors[key] = `Enter ${label}.`;
    return value;
  }

  const businessName = text("businessName", "your business name", 200);
  const recipientName = text("recipientName", "the recipient’s name", 200);
  const line1 = text("line1", "the first line of the address", 200);
  const line2 = text("line2", "the second line of the address", 200, false);
  const town = text("town", "the town or city", 100);
  const region = text("region", "the county or region", 100, false);

  const buyingForWork = fields.buyingForWork === true;
  if (!buyingForWork) errors.buyingForWork = "Confirm you’re buying for work.";

  const email = typeof fields.email === "string" && fields.email.length <= 254 && !controls.test(fields.email)
    ? fields.email.trim() : "";
  const at = email.indexOf("@");
  if (at > 64 || !emailPattern.test(email)) errors.email = "Enter a valid email address.";

  const postcode = parseUkPostcode(readPostcodeInput(fields.postcode) ?? "");
  if (!postcode.ok) errors.postcode = "Enter a valid UK postcode.";

  return Object.keys(errors).length || !postcode.ok || !buyingForWork
    ? { ok: false as const, errors }
    : {
        ok: true as const,
        fields: {
          businessName, buyingForWork, email: email.toLowerCase(),
          recipientName, line1, line2, town, region, postcode: postcode.value.normalised,
        },
      };
}
