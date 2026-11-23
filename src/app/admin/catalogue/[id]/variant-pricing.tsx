"use client";

import { parsePoundsToPence } from "@/lib/admin/pounds";
import { cataloguePriceTiers, type TierPrices } from "@/lib/admin/price-tiers";
import { formatGbp } from "@/lib/commerce/money";
import { PriceTierField } from "../price-tier-field";
import { sellingFormId, useEditorSnapshot } from "./editor-form";
import styles from "./editor.module.css";

export function VariantPricing({ prices, landedUnitPence, costSource, readOnly, draft }: {
  prices: TierPrices;
  landedUnitPence?: number | null;
  costSource?: string | null;
  readOnly?: boolean;
  draft?: boolean;
}) {
  const { costInput, sellingRevision } = useEditorSnapshot();
  const cost = costInput === undefined ? landedUnitPence : parsePoundsToPence(costInput);
  const preview = costInput !== undefined && cost !== (landedUnitPence ?? null);
  const marginUnavailable = costInput?.trim() && cost == null ? "Enter a valid landed cost" : "Cost missing";
  return (
    <section className={styles.pricePanel} aria-labelledby="selling-prices">
      <p className="eyebrow">Per blade · GBP</p>
      <h3 id="selling-prices">Selling prices</h3>
      {!readOnly && <p className="admin-muted">
        Enter prices excluding VAT.{draft && " A draft can have all three prices blank."}
      </p>}
      <p className={styles.costBasis} aria-live="polite">
        {cost == null
          ? marginUnavailable === "Cost missing" ? "Cost missing — margin isn’t available." : "Enter a valid landed cost to preview margin."
          : `${preview ? "Unsaved landed cost" : costSource === "receipt" ? "Latest costed receipt" : "Variant estimate"} · ${formatGbp(cost)} per blade`}
      </p>
      <div className={styles.tiers}>
        {cataloguePriceTiers.map(({ band, field, key }) => (
          <PriceTierField key={`${sellingRevision}:${key}`} band={band} field={field} initialPence={prices[key]} required={!draft}
            landedUnitPence={cost} readOnly={readOnly} form={readOnly ? undefined : sellingFormId}
            marginUnavailable={marginUnavailable} />
        ))}
      </div>
    </section>
  );
}
