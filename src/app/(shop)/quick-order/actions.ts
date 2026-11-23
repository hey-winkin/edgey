"use server";

import { z } from "zod";
import { searchExactBladeCodes } from "@/lib/catalogue/server";
import { publicClient } from "@/lib/catalogue/supabase";
import { lookupSelectionVariants } from "@/lib/checkout/server";
import { MAX_BASKET_LINES, MAX_ORDER_INTEGER, normaliseLines } from "@/lib/checkout/validation";
import {
  choiceField, groupedQuantities, isReady, matchQuickOrderLine, MAX_QUICK_ORDER_INPUT, MAX_QUICK_ORDER_LINES,
  parseQuickOrder, planQuickOrder, validPartCode, type Blade, type ParsedLine, type ResultLine,
} from "@/lib/quick-order/order";
import { allowSelectionQuote } from "@/lib/requests/rate-limit";
import type { LineRequest } from "@/lib/commerce";

type Review = { id: string; text: string; rows: ResultLine[]; error?: string; invalidInput?: boolean };
const retry = "We couldn’t check the latest prices and availability. Try again.";
const tooMany = "There have been too many checks. Try again later.";
const reviewedLine = z.object({
  number: z.int().positive().max(MAX_QUICK_ORDER_INPUT),
  code: z.string().refine(validPartCode),
  quantity: z.int().positive().max(MAX_ORDER_INTEGER),
  variantId: z.uuid(),
  chosen: z.boolean(),
});

async function prepare(
  parsed: ParsedLine[],
  choices: (line: Extract<ParsedLine, { code: string }>) => { choice?: string; expected?: string },
  basket: LineRequest[] = [],
) {
  const codes = [...new Set(parsed.flatMap((line) => "code" in line ? [line.code] : []))];
  const hits = new Map(await Promise.all(codes.map(async (code) => [code, await searchExactBladeCodes(code)] as const)));
  const ids = [...new Set([...hits.values()].flatMap((matches) => matches.map(({ variantId }) => variantId)))];
  const blades = new Map<string, Blade>();
  for (let i = 0; i < ids.length; i += MAX_BASKET_LINES) {
    const { data, error } = await publicClient().from("variants")
      .select("id,sku,option_label,tool,products!inner(slug,name)")
      .eq("publication_status", "published")
      .in("id", ids.slice(i, i + MAX_BASKET_LINES))
      .overrideTypes<{ id: string; sku: string; option_label: string | null; tool: string | null; products: { slug: string; name: string } }[], { merge: false }>();
    if (error) throw new Error("Quick order catalogue lookup failed.");
    for (const row of data ?? []) {
      blades.set(row.id, { id: row.id, sku: row.sku, slug: row.products.slug, name: row.products.name, optionLabel: row.option_label, tool: row.tool });
    }
  }

  const rows = parsed.map((line) => {
    if (!("code" in line)) return line;
    const { choice, expected } = choices(line);
    const exact = hits.get(line.code) ?? [];
    const candidates = exact.flatMap(({ variantId }) => {
      const blade = blades.get(variantId);
      return blade ? [blade] : [];
    });
    return candidates.length !== exact.length ? { ...line, candidates, chosen: false, issue: "The match changed. Check this line again." } :
      matchQuickOrderLine(line, candidates, choice, expected);
  });

  const groups = groupedQuantities(rows);
  const existing = new Map(basket.map(({ variantId, quantity }) => [variantId, quantity]));
  const combined = [...groups].map(([variantId, requested]) => ({
    variantId, quantity: Math.min(MAX_ORDER_INTEGER, requested + (existing.get(variantId) ?? 0)),
  }));
  const [stock, basketStock] = await Promise.all([
    combined.length ? lookupSelectionVariants(combined) : [],
    combined.length && basket.length ? lookupSelectionVariants(basket) : [],
  ]);
  return planQuickOrder(rows, stock, groups, basket, basketStock);
}

export async function checkQuickOrder(_: Review, form: FormData): Promise<Review> {
  const input = form.get("lines");
  const text = typeof input === "string" ? input : "";
  const parsed = parseQuickOrder(text);
  const initial = {
    id: crypto.randomUUID(),
    text: text.length <= MAX_QUICK_ORDER_INPUT * 2 ? text : "",
    rows: parsed.lines.filter((line) => "issue" in line),
  };
  if (parsed.issue) return { ...initial, error: parsed.issue, invalidInput: true };
  if (!parsed.lines.some((line) => "code" in line)) return initial;
  try {
    if (!await allowSelectionQuote()) return { ...initial, rows: [], error: tooMany };
    const basketInput = form.get("basket");
    const basket = typeof basketInput === "string" && basketInput.length <= 9_000
      ? normaliseLines(JSON.parse(basketInput)) ?? [] : [];
    const { rows } = await prepare(parsed.lines, (line) => {
      const choice = form.get(choiceField(line));
      return { choice: typeof choice === "string" && choice.length === 36 ? choice : undefined };
    }, basket);
    return { ...initial, rows };
  } catch {
    return { ...initial, rows: [], error: retry };
  }
}

export async function confirmQuickOrder(checked: unknown, currentBasket: unknown) {
  const result = z.array(reviewedLine).min(1).max(MAX_QUICK_ORDER_LINES).safeParse(checked);
  const basket = normaliseLines(currentBasket);
  if (!result.success || !basket || new Set(result.data.map(({ number }) => number)).size !== result.data.length) {
    return { error: "Check your lines again before adding them to your basket." };
  }
  try {
    if (!await allowSelectionQuote()) return { error: tooMany };
    const expected = new Map(result.data.map((row) => [row.number, row]));
    const { rows, lines } = await prepare(result.data.map((row) => ({
      number: row.number, code: row.code, quantity: row.quantity, input: "",
    })), basketLine => {
      const row = expected.get(basketLine.number)!;
      return { choice: row.chosen ? row.variantId : undefined, expected: row.variantId };
    }, basket);
    return {
      lines,
      added: rows.filter(isReady).map(({ number, quantity }) => ({ number, quantity })),
      failures: rows.flatMap(({ number, issue }) => issue ? [{ number, issue }] : []),
    };
  } catch {
    return { error: retry };
  }
}
