import { expect, it } from "vitest";
import type { Family } from "@/lib/catalogue";
import { searchMachineModels } from "@/lib/catalogue/machine-search";

const families = [{
  slug: "edg-z16",
  variants: [{
    sku: "EDG-Z16",
    compatibility: [
      { brand: { name: "Zünd" }, machine: "G3, S3, L3" },
      { brand: { name: "Mimaki" }, machine: "CG-SRIII; CJV150" },
      { brand: { name: "Roland" }, machine: "CAMM-1 (GS-24, GR2, GX series)" },
      { brand: null, machine: null },
    ],
  }],
}] as Family[];

it.each(["G3", "Zund G3", "zünd s3", "CG-SRIII", "mimaki cjv-150", "Roland GS-24", "CAMM-1"])("suggests published buyer-visible machine fit for %s", (query) => {
  expect(searchMachineModels(families, query)).toEqual([
    { matchType: "suggested", matchedCode: null, productSlug: "edg-z16", sku: "EDG-Z16" },
  ]);
});

it.each(["", "3", "Zünd G", "Zünd CJV150", "CJV300", "5201345"])("does not guess machine fit for %s", (query) => {
  expect(searchMachineModels(families, query)).toEqual([]);
});
