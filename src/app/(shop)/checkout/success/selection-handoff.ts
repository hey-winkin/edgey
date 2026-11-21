import type { LineRequest } from "@/lib/commerce";

const markerKey = "edgey-storefront-checkout-selection-v1";
const lockName = "edgey-storefront-selection";
const maxCheckoutScopes = 8;

type CheckoutSelectionMarker = { nonce: string; snapshot: string; scopes: string[] };
type SelectionPredicate = (lines: readonly LineRequest[]) => boolean;

function readMarker(): CheckoutSelectionMarker | null {
  const marker: unknown = JSON.parse(localStorage.getItem(markerKey) ?? "null");
  if (!marker || typeof marker !== "object" ||
    !("nonce" in marker) || typeof marker.nonce !== "string" ||
    !("snapshot" in marker) || typeof marker.snapshot !== "string" ||
    !("scopes" in marker) || !Array.isArray(marker.scopes) ||
    !marker.scopes.every((scope: unknown) => typeof scope === "string")) return null;
  return { nonce: marker.nonce, snapshot: marker.snapshot, scopes: marker.scopes };
}

function selectionSnapshot(lines: readonly LineRequest[]) {
  return JSON.stringify(lines.map(({ variantId, quantity }) => [variantId, quantity] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
}

async function withSelectionLock<T>(callback: () => T): Promise<T | undefined> {
  try {
    return await navigator.locks?.request(lockName, callback);
  } catch {
    return undefined;
  }
}

export function persistSelectionChange(write: () => void) {
  function persist() {
    try {
      localStorage.removeItem(markerKey);
      write();
    } catch {}
  }
  if (navigator.locks) void withSelectionLock(persist);
  else persist();
}

export async function captureCheckoutSelection(lines: readonly LineRequest[]): Promise<string | null> {
  if (lines.length === 0) return null;
  return await withSelectionLock(() => {
    const snapshot = selectionSnapshot(lines);
    const marker = readMarker();
    if (marker) return marker.snapshot === snapshot ? marker.nonce : null;
    const nonce = crypto.randomUUID();
    localStorage.setItem(markerKey, JSON.stringify({ nonce, snapshot, scopes: [] }));
    return nonce;
  }) ?? null;
}

export async function createHashScope(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function rememberCheckoutSelection(sessionId: string, nonce: string | null) {
  if (!nonce) return;
  try {
    const scope = await createHashScope(sessionId);
    await withSelectionLock(() => {
      const marker = readMarker();
      if (marker?.nonce !== nonce || marker.scopes.includes(scope)) return;
      marker.scopes = [...marker.scopes.slice(-(maxCheckoutScopes - 1)), scope];
      localStorage.setItem(markerKey, JSON.stringify(marker));
    });
  } catch {}
}

export async function clearConfirmedCheckoutSelection(
  scope: string,
  paidLines: readonly LineRequest[],
  clearIf: (matches: SelectionPredicate) => boolean,
) {
  if (paidLines.length === 0) return;
  const snapshot = selectionSnapshot(paidLines);
  await withSelectionLock(() => {
    const marker = readMarker();
    if (marker?.snapshot !== snapshot || !marker.scopes.includes(scope)) return;
    if (clearIf((lines) => selectionSnapshot(lines) === snapshot)) localStorage.removeItem(markerKey);
  });
}
