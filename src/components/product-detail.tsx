"use client";

import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";
import {
  familySubstrates,
  productHref,
  variantChoiceCue,
  variantFit,
  variantLabel,
  variantReference,
  type Family,
  type Media,
  type Variant,
} from "@/lib/catalogue";
import { formatPence, incVatLabel, PRICE_BREAKS, unitPricePence, VAT_RATE_PERCENT, withVatPence } from "@/lib/catalogue/display-prices";
import { MAX_ORDER_INTEGER } from "@/lib/checkout/validation";
import { formatGbp } from "@/lib/commerce";
import { useSelection } from "./selection-provider";
import { DispatchNotice, useDispatchNotice } from "./dispatch-notice";
import { useSelectionQuote } from "./use-selection-quote";

const availabilityWords = { in_stock: "In stock", out_of_stock: "Out of stock" } as const;

// The product detail, shared by the dialog and the page at /blades/[slug], in
// one reading order: figure, part code, name, reference, tool fit, materials,
// availability, variant, quantity, total, per-unit price, primary action.
export function ProductDetail({
  family,
  initialSku,
  mode,
}: {
  family: Family;
  initialSku: string | null;
  mode: "dialog" | "page";
}) {
  const id = useId();
  const preselected =
    family.variants.find((variant) => variant.sku === initialSku) ??
    (family.variants.length === 1 ? family.variants[0] : undefined);
  const [sku, setSku] = useState(preselected?.sku ?? null);
  const [quantityInput, setQuantityInput] = useState("1");
  const variant = family.variants.find((candidate) => candidate.sku === sku) ?? null;
  const startingNet = !variant && family.variants.length > 1
    ? Math.min(...family.variants.map(({ prices }) => unitPricePence(prices, 1)))
    : null;
  const media = variant?.media ?? family.media;
  const figureCode = variant?.sku ?? family.familyCode;
  const Heading = mode === "dialog" ? "h2" : "h1";
  const { add, open, hydrated } = useSelection();

  function choose(next: Variant) {
    setSku(next.sku);
    window.history.replaceState(null, "", productHref(family.slug, next.sku));
  }

  const materials = (variant ? variant.substrates : familySubstrates(family)).map((substrate) => substrate.name);
  const fit = variant ? variantFit(variant, mode === "dialog") : [];
  const quantity = Number(quantityInput);
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_ORDER_INTEGER;
  const outOfStock = variant?.availability === "out_of_stock";
  const lines = variant && validQuantity && !outOfStock ? [{ variantId: variant.id, quantity }] : [];
  const { quote, clock, pending, retry } = useSelectionQuote(lines, lines.length > 0, { includeProductNames: false });
  const dispatch = useDispatchNotice(quote, clock, retry);
  const priced = quote?.status === "ok" ? quote : null;
  const quotedLine = priced?.basket?.lines[0];
  const line = priced?.corrections.length ? undefined : quotedLine;
  const unitNetPence = variant && unitPricePence(variant.prices, quantity);
  const catalogueNet = unitNetPence === null ? null : unitNetPence * quantity;
  const catalogueGross = catalogueNet !== null && catalogueNet <= MAX_ORDER_INTEGER ? withVatPence(catalogueNet) : null;
  const displayLine = line ?? (outOfStock && validQuantity && catalogueNet !== null &&
    catalogueGross !== null && catalogueGross <= MAX_ORDER_INTEGER && unitNetPence !== null ? {
      unitNetPence,
      lineNetPence: catalogueNet,
      lineGrossPence: catalogueGross,
    } : null);
  const availability = !variant ? "Choose a variant"
    : priced && !quotedLine ? "Unavailable"
    : availabilityWords[variant.availability];
  const blocked = !variant
    ? "Choose a variant before adding this blade."
    : outOfStock
      ? "This variant is out of stock and cannot be added."
      : priced?.corrections.length
        ? quotedLine
          ? "There isn’t enough stock for this quantity. Try a smaller quantity."
          : "This variant is no longer available to add."
        : null;
  const priceBreaks = mode === "page" && variant && (
    <div className="table-scroll" role="region" tabIndex={0} aria-labelledby={id + "-price-breaks"}>
      <table className="data-table breaks">
        <caption id={id + "-price-breaks"}>Price breaks per blade for {variant.sku}</caption>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col" className="num">ex VAT</th>
            <th scope="col" className="num">inc VAT ({VAT_RATE_PERCENT}%)</th>
          </tr>
        </thead>
        <tbody>
          {PRICE_BREAKS.map(({ from, label, tier }, index) => (
            <tr key={from} aria-current={validQuantity && quantity >= from &&
              (PRICE_BREAKS[index + 1]?.from ?? Infinity) > quantity ? "true" : undefined}>
              <th scope="row">{label} blades</th>
              <td className="num">{formatPence(variant.prices[tier])}</td>
              <td className="num">{formatPence(withVatPence(variant.prices[tier]))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const details = (
    <>
      <div className={mode === "dialog" ? "dialog-product-id" : undefined}>
        <p className="eyebrow">{figureCode}</p>
        {mode === "dialog" && media.drawing && <span className="fine">Drawing not to scale</span>}
        {mode === "dialog" && media.photo && <a className="textlink" href={"/photos/" + media.photo}>View photograph</a>}
      </div>
      <Heading id={mode === "dialog" ? "detail-title" : undefined}>{family.name}</Heading>
      <dl className="specs">
        <dt>OEM / reference</dt>
        <dd>
          {variant
            ? (variantReference(variant) ?? "No verified reference yet")
            : [...new Set(family.variants.map(variantReference).filter(Boolean))].join(" · ") || "No verified reference yet"}
        </dd>
        <dt>Tool fit</dt>
        <dd>
          {family.toolType.name}
          {fit.length > 0 ? " · " + fit.join(" · ") : ""}
        </dd>
        <dt>Materials</dt>
        <dd>{materials.join(", ") || "Ask us"}</dd>
        <dt>Availability</dt>
        <dd>{availability}</dd>
      </dl>
      <DispatchNotice copy={line ? dispatch : null} />
      {line && dispatch && <p className="fine">Dispatch is provisional until payment or authorisation on account.</p>}

      {startingNet !== null && (
        <p className="variant-start-price">
          <span>From <strong>{formatPence(startingNet)}</strong> ex VAT per blade</span>{" "}
          <span className="fine">{incVatLabel(startingNet)}</span>
        </p>
      )}
      {family.variants.length > 1 && (
        <fieldset className="quantity-set">
          <legend>Variant</legend>
          <div className={variant ? "qty-options" : "qty-options variant-options"}>
            {family.variants.map((candidate) => {
              const cue = !variant ? variantChoiceCue(candidate, family.variants) : undefined;
              return (
                <button
                  key={candidate.sku}
                  type="button"
                  aria-pressed={candidate.sku === sku}
                  onClick={() => choose(candidate)}
                >
                  <span>
                    {variantLabel(candidate)}
                    {candidate.availability === "out_of_stock" && " · Out of stock"}
                  </span>
                  {cue && <span className="variant-cue">{cue.replace(/\s*\/\s*/g, " / ")}</span>}
                </button>
              );
            })}
          </div>
          {!variant && (
            <p className="choice-note" role="status">Choose the configuration that matches your holder.</p>
          )}
        </fieldset>
      )}

      {variant && <fieldset className="quantity-set">
        <legend><label htmlFor={id + "-qty"}>Quantity</label></legend>
        {mode === "dialog" && (
          <div className="dialog-breaks" role="group" aria-labelledby={id + "-price-breaks"}>
            <p id={id + "-price-breaks"} className="fine">Price breaks per blade · ex VAT</p>
            <dl>
              {PRICE_BREAKS.map(({ from, label, tier }) => (
                <div key={from}>
                  <dt>{label} blades</dt>
                  <dd>{formatPence(variant.prices[tier])}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <div className="qty-row">
          <div className="qty-options">
            {PRICE_BREAKS.map((priceBreak) => (
              <button
                key={priceBreak.from}
                type="button"
                aria-pressed={quantity === priceBreak.from}
                onClick={() => setQuantityInput(String(priceBreak.from))}
              >
                {priceBreak.from}
              </button>
            ))}
          </div>
          <input
            id={id + "-qty"}
            className="qty-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ORDER_INTEGER}
            step={1}
            value={quantityInput}
            aria-invalid={!validQuantity || undefined}
            aria-describedby={!validQuantity ? id + "-quantity-error" : undefined}
            onChange={(event) => setQuantityInput(event.target.value)}
          />
        </div>
      </fieldset>}

      <div className="detail-total" aria-live="polite">
        {displayLine ? (
          <>
            <span className="fine">{formatGbp(displayLine.unitNetPence)} each · ex VAT</span>
            <span className="detail-prices">
              <span className="fine">Total for {quantity} {quantity === 1 ? "blade" : "blades"}</span>
              <span><strong>{formatGbp(displayLine.lineNetPence)}</strong> <span className="fine">ex VAT</span></span>
              <span>{formatGbp(displayLine.lineGrossPence)} inc VAT ({(priced?.basket?.vatRateBasisPoints ?? VAT_RATE_PERCENT * 100) / 100}%)</span>
            </span>
            {line && line.savingPence > 0 && <span className="fine">Quantity saving: {formatGbp(line.savingPence)} ex VAT</span>}
            {line?.savingPrompt && <span className="fine">{line.savingPrompt.message}</span>}
          </>
        ) : variant && !validQuantity ? (
          <span className="fine" id={id + "-quantity-error"}>Enter a positive whole quantity to see the total.</span>
        ) : outOfStock ? (
          <span className="fine">This quantity exceeds the checkout limit. Try a smaller quantity.</span>
        ) : pending ? <span className="fine">Checking current price…</span> : null}
      </div>

      <button type="button" className="primary full" disabled={!line || !hydrated}
        aria-describedby={blocked || quote?.status === "error" ? id + "-add-note" : undefined}
        onClick={(event) => {
          if (!line) return;
          add(line.variantId, line.quantity);
          if (mode === "dialog") event.currentTarget.closest("dialog")?.close();
          open(mode === "page" ? event.currentTarget : undefined);
        }}>
        Add to basket
      </button>
      <div role="status">
        {(blocked || quote?.status === "error") && (
          <p className="fine" id={id + "-add-note"}>{quote?.status === "error" ? quote.message : blocked}</p>
        )}
      </div>
      {quote?.status === "error" && <button type="button" className="textlink" onClick={retry}>Retry price</button>}

      {priceBreaks}
    </>
  );

  if (mode === "dialog") return (
    <>
      <div className="dialog-scroll" role="region" aria-label="Blade specifications and options" tabIndex={0}>
        <ProductArtwork media={media} code={figureCode} />
        {details}
      </div>
      <div className="product-dialog-footer">
        <a className="textlink" href={productHref(family.slug, family.variants.length > 1 ? variant?.sku : null)}>
          Full specification and price <span className="spec-link-end">breaks <ArrowUpRight size={13} aria-hidden="true" /></span>
        </a>
      </div>
    </>
  );
  return (
    <div className="product-grid">
      <div className="product-artwork">
        <ProductArtwork media={media} code={figureCode} priority />
        {media.drawing && (
          <p className="fine figure-note">
            Drawing for identification. Not to scale.
            {media.photo && <> <a className="textlink" href={"/photos/" + media.photo}>View photograph</a></>}
          </p>
        )}
      </div>
      <section className="product-panel" aria-label="Fit, availability and price">{details}</section>
    </div>
  );
}

function ProductArtwork({ media, code, priority }: { media: Media; code: string; priority?: boolean }) {
  return (
    <figure className={"figure-plate" + (media.drawing ? "" : " figure-plate-plain")} data-proof={media.drawing ? media.proof : undefined}>
      {media.drawing ? (
        <Image src={"/line-art/" + media.drawing} alt={"Line drawing for " + code}
          width={776} height={400} priority={priority} unoptimized />
      ) : <span className="plate-code">{code}</span>}
    </figure>
  );
}
