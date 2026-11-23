"use client";

import { useId, useState } from "react";
import { formatPoundsInput, parsePoundsToPence, POUNDS_INPUT_PATTERN } from "@/lib/admin/pounds";
import { tierMargin } from "@/lib/admin/price-tiers";
import { incVatLabel } from "@/lib/catalogue/display-prices";
import { formatGbp } from "@/lib/commerce/money";

const percent = new Intl.NumberFormat("en-GB", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function PriceTierField({ band, field, initialPence, required, landedUnitPence, readOnly, form, marginUnavailable }: {
  band: string; field: string; initialPence: number | null | undefined;
  required?: boolean; landedUnitPence?: number | null; readOnly?: boolean;
  form?: string; marginUnavailable?: string;
}) {
  const id = useId();
  const [pounds, setPounds] = useState(() => formatPoundsInput(initialPence));
  const pence = readOnly ? initialPence : parsePoundsToPence(pounds);
  const margin = pence ? tierMargin(pence, landedUnitPence) : null;

  return <div className="admin-field content-start">
    {readOnly ? <>
      <span>{band}</span>
      <span className="admin-mono">{pence ? `${formatGbp(pence)} ex VAT` : "Not set"}</span>
    </> : <>
      <label htmlFor={id}>{band} (£ ex VAT)</label>
      <input id={id} name={field} form={form} inputMode="decimal" value={pounds}
        onChange={(event) => setPounds(event.target.value)}
        pattern={POUNDS_INPUT_PATTERN} placeholder="0.00" required={required}
        aria-describedby={pence || marginUnavailable ? `${id}-preview` : undefined} />
    </>}
    {pence || marginUnavailable ? <div id={`${id}-preview`} className="admin-muted">
      {pence ? <div>{incVatLabel(pence)}</div> : null}
      {margin ? <div>Margin ex VAT: {formatGbp(margin.marginPence)} ({percent.format(margin.marginRate)})
        {margin.marginPence < 0 && <> · <strong>Below landed cost</strong></>}
      </div> : marginUnavailable && <div>Margin: {landedUnitPence == null ? marginUnavailable : readOnly ? "No selling price" : "Enter a selling price"}</div>}
    </div> : null}
  </div>;
}
