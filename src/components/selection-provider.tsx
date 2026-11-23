"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { persistSelectionChange, persistSelectionChangeIf } from "@/app/(shop)/checkout/success/selection-handoff";
import { forgetCheckoutAttempt } from "@/lib/checkout/attempt-token";
import { MAX_BASKET_LINES, MAX_ORDER_INTEGER } from "@/lib/checkout/validation";
import type { LineRequest } from "@/lib/commerce";

const storageKey = "edgey-storefront-selection-v1";
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const empty: LineRequest[] = [];

function restore(): LineRequest[] | null {
  let text: string | null;
  try { text = localStorage.getItem(storageKey); } catch { return null; }
  try {
    const stored: unknown = JSON.parse(text ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return empty;
    const quantities = new Map<string, number>();
    for (const [id, quantity] of Object.entries(stored)) {
      if (uuid.test(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= MAX_ORDER_INTEGER) {
        quantities.set(id.toLowerCase(), quantity);
        if (quantities.size === MAX_BASKET_LINES) break;
      }
    }
    return [...quantities].map(([variantId, quantity]) => ({ variantId, quantity }));
  } catch {
    return empty;
  }
}

function save(lines: LineRequest[]) {
  localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(lines.map(({ variantId, quantity }) => [variantId, quantity]))));
}

function sameLines(previous: LineRequest[], next: LineRequest[]) {
  return previous.length === next.length && previous.every((line, index) =>
    line.variantId === next[index]?.variantId && line.quantity === next[index]?.quantity
  );
}

type Selection = {
  lines: LineRequest[];
  hydrated: boolean;
  revision: number;
  replace: (lines: LineRequest[]) => void;
  replaceIfUnchanged: (lines: LineRequest[], expectedRevision: number) => Promise<boolean>;
  clearIf: (matches: (lines: readonly LineRequest[]) => boolean) => boolean;
  setQuantity: (variantId: string, quantity: number) => void;
  add: (variantId: string, quantity: number) => void;
  open: (from?: HTMLElement) => void;
  opened: { from?: HTMLElement } | null;
  close: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<{ lines: LineRequest[]; revision: number }>();
  const current = useRef(stored);
  const latestWrite = useRef<object | null>(null);
  const [opened, setOpened] = useState<Selection["opened"]>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const restored = { lines: restore() ?? empty, revision: 0 };
      current.current = restored;
      setStored(restored);
    });
    function sync(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      const now = current.current;
      const lines = restore();
      if (!now || !lines || sameLines(now.lines, lines)) return;
      const next = { lines, revision: now.revision + 1 };
      forgetCheckoutAttempt();
      current.current = next;
      setStored(next);
    }

    window.addEventListener("storage", sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function replace(lines: LineRequest[]) {
    const now = current.current;
    if (!now || sameLines(now.lines, lines)) return;
    const next = { lines, revision: now.revision + 1 };
    latestWrite.current = next;
    forgetCheckoutAttempt();
    current.current = next;
    setStored(next);
    persistSelectionChange(() => {
      save(lines);
      if (latestWrite.current === next && current.current && current.current !== next) {
        const synced = { lines, revision: current.current.revision + 1 };
        current.current = synced;
        setStored(synced);
      }
    });
  }

  function replaceIfUnchanged(lines: LineRequest[], expectedRevision: number) {
    return persistSelectionChangeIf(() => {
      const now = current.current;
      const saved = restore();
      if (!now || now.revision !== expectedRevision || (saved && !sameLines(now.lines, saved))) return false;
      if (saved) save(lines);
      const next = { lines, revision: now.revision + 1 };
      latestWrite.current = next;
      forgetCheckoutAttempt();
      current.current = next;
      setStored(next);
      return true;
    });
  }

  function clearIf(matches: (lines: readonly LineRequest[]) => boolean) {
    const now = current.current;
    const saved = restore();
    if (!now || !saved || now !== stored || !matches(now.lines) || !matches(saved)) return false;
    localStorage.removeItem(storageKey);
    const next = { lines: empty, revision: now.revision + 1 };
    current.current = next;
    setStored(next);
    return true;
  }

  function setQuantity(variantId: string, quantity: number) {
    const lines = current.current?.lines ?? empty;
    if (quantity === 0) replace(lines.filter((line) => line.variantId !== variantId));
    else if (lines.some((line) => line.variantId === variantId)) {
      replace(lines.map((line) => line.variantId === variantId ? { variantId, quantity } : line));
    } else replace([...lines, { variantId, quantity }]);
  }

  return (
    <SelectionContext.Provider value={{
      lines: stored?.lines ?? empty,
      hydrated: !!stored,
      revision: stored?.revision ?? 0,
      replace,
      replaceIfUnchanged,
      clearIf,
      setQuantity,
      add: (variantId, quantity) => {
        const previous = current.current?.lines.find((line) => line.variantId === variantId)?.quantity ?? 0;
        setQuantity(variantId, Math.min(MAX_ORDER_INTEGER, previous + quantity));
      },
      opened,
      open: (from) => setOpened({ from }),
      close: () => setOpened(null),
    }}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error("Selection requires its provider.");
  return selection;
}
