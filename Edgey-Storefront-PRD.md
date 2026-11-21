# Edgey storefront
## Product requirements for the UK trade launch

**Revision 3 · 20 November 2026 · Staging build specification**

*Revision 3 aligns the UI requirements with the approved design pack: the visual direction in §2 now defers to `design.md`, §4.1 to §4.6 are new, §6 gains a styling note and §7 gains a UI evidence row. Behaviour, data, pricing and release scope are unchanged from revision 2.*

A print production manager has a cutter waiting and a part number on an old packet. Edgey should let them identify the exact replacement, see which tool or holder it fits, order the right quantity and know when it will leave the warehouse. A buyer who is unsure of the fit should be able to ask a person or request two trial blades before committing to a pack.

The first release proves that journey from search to a pickable order. Approved trade buyers will also be able to order against a purchase order on 30-day terms. Card checkout and trade credit have separate release criteria.

## 1. Release scope

| Release | What ships | What demonstrates completion |
| --- | --- | --- |
| Weekend staging | Blade Finder, catalogue and product pages, basket, hosted Stripe test checkout, free trial request, staff picking and dispatch queue | A buyer finds the exact variant from its packet, orders it and receives confirmation. A member of staff can pick that same variant and record dispatch. Two buyers competing for the last blade cannot both buy it. |
| First live release | Verified variants with opening stock, guest card and eligible wallet payments, trial requests, operational email, order handling and approved delivery coverage. Trade applications can be collected for review. | The owners in §8 have completed the applicable launch checks. Authorised staff complete one controlled live-mode purchase, check the pick list, then cancel and reconcile the refund before dispatch. |
| Trade credit release | Approved-account checkout, required PO number, Stripe Net 30 invoices, credit control, account history, invoice downloads and reorder | Finance can trace a PO from authorisation through dispatch and settlement. The credit, cancellation and access scenarios in §7 pass. |

**Commercial measures.** Record exact, suggested and unmatched searches, the share of exact matches that reach a paid or authorised order, sample dispatches that lead to a first purchase, and orders dispatched by the promised date. Record wrong-fit returns against the variant and the lookup code. Review these measures after the pilot to set targets and choose the next range. Keep personally identifying details out of analytics events.

## 2. Catalogue and Blade Finder

The buying matrix in Appendix A contains **26 draft product families**. A family has a product page. A **variant** is one purchasable physical blade with its own permanent SKU, stock count and picking label. A single-variant family may reuse its family code as its SKU. Multi-variant families require distinct SKUs for each stocked angle, shank or holder combination. Five and ten are quantities of the same blade.

For each launch variant the catalogue owner records its supplier part number, Edgey SKU, OEM reference and brand, tool or holder, any necessary adapter or machine restriction, verified dimensions, applicable substrates, source and approval date. Distinguish the manufacturer’s description of the original from the supplier’s evidence that the Edgey replacement fits it. Record material and carbide-grade claims only where supported. A family can go live as soon as it has one approved variant with complete selling data. JWEI and iEcho can be selected on an enquiry from day one. Publish brand landing pages and compatibility claims when a verified mapping exists.

**Finder behaviour**

1. Trim and normalise case, spaces and hyphens for code lookup. Preserve the original printed codes for display. A verified exact Edgey or OEM code ranks first and identifies the matching variant and tool. Where an exact code has multiple valid configurations, show the choices and require a selection.
2. Brand, substrate and fuzzy text searches return labelled suggestions. Show the machine, holder, angle or shank that distinguishes similar results. A search such as “Foamex” may help someone browse. It cannot establish which holder they own.
3. An unmatched code shows **“Ask us to match this blade”** and carries the query into the enquiry. Staff receive the query and the buyer’s reply address. Private candidate aliases must never surface in public search, filters, structured data or SEO titles.
4. Index approved records only. Test the search RPC against seeded staging data at p95 under 50 ms over 100 representative warm queries. Measure page-to-results latency separately on mobile. Show stock status on the product page and recheck availability at checkout.

**Visual direction.** The approved design pack governs how the storefront looks and how its controls behave: `design.md` (version 3), `design-tokens.json`, `Edgey-preview.html`, `assets/` and `figures/`. Where this document and the pack disagree on look, layout, components, wording style or interaction styling, follow the pack. In short, the storefront opens in a graphite dark theme and offers a warm-white light theme with the same hierarchy. Surfaces are square, fine-ruled and neutral, and the primary action is a neutral high-contrast button that ends in a narrow hatched cap. Colour appears only where a printed surface would carry it, through the five named print proofs, so text, prices and controls sit on neutral fields. §4.1 to §4.6 apply the system to every route.

Put the part code, OEM reference, tool fit, variant and both prices in the first screen of the product detail, in the reading order in §4.3. Support keyboard search, labelled inputs and visible focus as `design.md` specifies. State availability in words (§4.4). No part of the interface relies on colour to show status.

## 3. Prices, delivery and samples

| Rule | Required behaviour |
| --- | --- |
| Buyer and currency | UK business purchases in GBP. Guest checkout asks for business name and confirmation of buying for work. Label the business price clearly, show the 20% rate and the VAT-inclusive figure beside it. Keep the gross total visible before payment. Finance confirms VAT registration, invoice details and applicable rate before enabling live sales. [ASA pricing guidance](https://www.asa.org.uk/advice-online/compulsory-costs-and-charges-vat.html) · [HMRC VAT guidance](https://www.gov.uk/charge-reclaim-record-vat) |
| Quantity tiers | Combine basket lines for the **same variant**. Apply the 1–4, 5–9 or 10+ unit rate to every blade on that line. Different angles, holders and variants have independent breaks. Show the unit price, line total and any saving. A reorder uses current stock and prices and asks the buyer to confirm. |
| Delivery price | Charge £6.95 ex VAT below £150.00 of goods ex VAT. Delivery is free from £150.00 inclusive of the threshold. Evaluate the threshold after quantity pricing, before VAT and delivery. Display progress in the same ex-VAT basis. |
| Delivery coverage | Store the carrier’s supported UK postcode areas and service levels. Check the full delivery postcode before payment. For an unsupported address, offer a delivery enquiry. Where next working day is unavailable, display the agreed service and charge for that destination, or offer an enquiry if terms are missing. |
| Dispatch | Use Europe/London time and the warehouse working-day calendar, including closures and bank holidays. An in-stock order paid or authorised on account **before 15:30** on a working day qualifies for same-day dispatch. At 15:30 or later use the next working day. Display the dispatch date separately from estimated delivery. A qualifying Friday order normally dispatches Friday for Monday delivery where both are working days and the carrier offers that service. |
| Commercial claims | Position Edgey as a precision replacement-blade supplier. The 12–18% undercut is an internal buying target. Compare equivalent variants, pack sizes and ex-VAT prices against dated evidence before publishing any competitor, quality or savings claim. |
| Two-blade trial | Ask initially for machine brand, OEM code or “unknown”, work email, company and postcode. Confirm receipt on screen and by email. Staff check fit, duplicates, eligibility and delivery coverage, then collect recipient name and full address and approve two specific blade units. Record their stock movements, dispatch and tracking. Link a subsequent purchase to the request when identified. A request alone makes no delivery promise. |

Use integer pence throughout. The server prices every basket from current variant records. For the proposed standard-rated range, use an exclusive 20% VAT rate on each goods line and on charged delivery. Calculate tax on the net line total, round half up to the nearest penny and sum the rounded amounts. Configure card checkout and invoices to agree with that rule. Finance verifies this against Stripe test invoices before launch. Save the applied rate, unit and line amounts, net delivery, tax and gross total on the order. A mismatch between Stripe’s final amount and the order goes to staff review before dispatch.

**Pricing examples.** Five Z10s are £99.75 ex VAT. With £6.95 delivery, VAT is £21.34 and the order total is **£128.04**. Nine Z10s cost £179.55 ex VAT and ten cost £175.00. In that nine-blade basket, show **“Add one blade and save £4.55 before VAT”** when a tenth is available. This is an intentional consequence of the proposed all-units pricing.

## 4. Storefront and staff journeys

| Route | What the user must be able to do |
| --- | --- |
| `/`, `/blades` | Search by printed part number or Edgey SKU, browse verified machine brands, and filter by tool category and substrate. An empty result offers a compatibility enquiry. |
| `/blades/[slug]` | Inspect fit, technical specifications, availability and price breaks. Choose the specific variant and quantity. Use verified variant data for page metadata and Product structured data. |
| `/checkout` | Review the priced basket and dispatch estimate. Enter the business, contact email, recipient and full UK delivery address once in Edgey. Use address autocomplete where available. Amend the address or basket before starting payment. |
| `/checkout/success` | Show a scoped confirmation for this checkout. Display “Confirming payment” if confirmation is still pending. A repeated visit is read-only. Send guests their confirmation and invoice access by email. |
| `/sample-pack`, `/trade` | Submit the short trial request or apply for an account using a verified login, company and billing details. Applications start pending. Tell the applicant how they will hear back. |
| `/account` | See the signed-in buyer’s orders, invoices and dispatch status. Approved trade buyers also see available credit, outstanding balance and PO references. Reorder into a fresh basket and highlight unavailable items. |
| `/admin` | Manage catalogue approvals, selling prices, supplier costs, receipts and stock adjustments. Respond to enquiries, review trial requests, and pick and dispatch eligible orders. Show the exact variant, bin or picking reference, quantity, delivery address, service and promised dispatch date. Record carrier and tracking. Finance staff handle credit approvals, invoice exceptions and refunds. |
| `/admin/sales` | Compare booked sales with the immediately preceding period of the same length in UK calendar days. Review revenue, tax, delivery, orders, units, average order value, refunds, sales by blade and stock cover. Switch the chart between day, week and month, break sales down by tier, payment method and buyer history, and export daily and product totals. Finance also sees estimated gross margin. |

At launch one named buyer owns each trade account, with one credit limit and Stripe customer. Record that limitation in the application flow. Guest email alone never grants access to an existing account or its order history.

**Catalogue and costs.** Catalogue staff enter business prices in pounds per blade and see all three VAT-inclusive prices alongside them. Catalogue and finance staff can set or correct a supplier-cost estimate before stock arrives. When receiving stock, staff with both warehouse and cost permissions can record the supplier unit price and currency and the landed unit cost in pounds. Exchange rate, freight and duty per blade, and a non-identifying note are optional. Do not record supplier names or contact details in cost records. Catalogue or finance staff can correct the latest receipt's costs without changing its stock movement or original values. Show each tier's gross margin per blade, in pounds and as a share of its ex-VAT sale price. Warn below cost without preventing a save. Catalogue staff can return a published variant to draft or archive it permanently. Both hide it from the Finder and storefront without removing stock or changing orders already placed.

**Sales reporting.** The database serves aggregates to approved warehouse, catalogue and finance sessions only. Sales count on card capture or Net 30 authorisation, including dispatch and excluding pre-dispatch cancellations and free trials. Revenue is the booked blade value before VAT, delivery or later adjustments; VAT includes delivery VAT. Average order value uses the same revenue basis. Recorded cash refunds and Net 30 invoice-balance reductions are shown separately, including for cancelled orders, on their reconciliation dates. Amounts without a monetary record are not inferred, and post-dispatch adjustments neither rewrite booked sales nor restore stock. These figures are for management reporting, not a tax or settlement ledger. Finance-only gross margin uses the latest costed receipt on or before each sale, with corrections, or the current variant estimate if there was no costed receipt. If any sold line lacks both, product and total margin are unknown. Distinguish repeat signed-in buyers by account and repeat guests by email; do not link the two. For published blades, use current available stock after reservations and average weekly booked units over the chosen period to flag under two weeks of cover, and flag blades with no qualifying sale on record. Keep sales of retired blades in the sales history. Neither downloads nor the page disclose customer-level data.

### 4.1 Design authority and vocabulary

Build every screen from the approved design pack: `design.md` (version 3), `design-tokens.json`, `Edgey-preview.html`, `assets/` and `figures/`. For look, layout, components, wording style and interaction styling the pack wins over this document. Take values from `design-tokens.json` and the tables in `design.md`. This document does not restate them.

The pack’s reference is one home page with two native dialogs: the product detail and the selection. Its products, prices, counts and notices are a demo. The catalogue data, prices and rules in this document replace them.

The two documents use different words for the same things. Customer-facing screens use the design’s words.

| This document says | The interface says | Note |
| --- | --- | --- |
| Blade Finder | Catalogue search: the “Search blades” field, reached from the hero action “Find a blade” | There is no separate Finder screen. The Finder rules in §2 describe how that field behaves. |
| Basket | Selection: “Selection” with a count of blades in the masthead, “Your selection”, “Add to selection” | The same thing. “Basket” stays the term for data and behaviour in this document. Buyers never see it. |
| Product page | Product detail, as the approved dialog and as the page at `/blades/[slug]` | See §4.3. |
| Tool category | Tool type: the “Tool type” filter, “All tool types” | |
| Substrate filter | Material index: “What are you cutting?”, “Materials” in the masthead | Choosing a row filters the catalogue. |
| “Require a selection” (§2, Finder rule 1) | A choice of variant in the product detail | Not the selection dialog. |

### 4.2 Route map

Every route uses the approved masthead, shared frame, printed footer, both themes and the rules in §4.5. The pack designs `/`, the product dialog and the selection dialog. Every other screen is an extension with no approved reference. Build each one from the components named here and from “Applying the system to another page” in `design.md`. Extension screens stay neutral. Proof colour appears only in product figure crops and the footer print sample.

| Route or surface | Approved reference | Build it from | Status |
| --- | --- | --- | --- |
| `/` | The whole reference page | Masthead, hero and material study, catalogue with search and tool-type filter, material index, printed footer, in that order. | Approved. Extended only as §4.4 lists. |
| `/blades` | None of its own | The catalogue section of `/` as a page: section heading, search field, tool-type select, result count with “Clear filters”, the card grid (four across on desktop, two across on phones), the zero-result panel and the material index. No hero or material study. | Extension |
| Product dialog | The approved product dialog | Matching product-page drawing or neutral part-code plate, part code, product name, description-list specification, pack choice, total, per-unit price, full-width primary action. Link to an approved photograph where available. | Approved. Extended as §4.3 and §4.4 list. |
| `/blades/[slug]` | None of its own. “A product family page” in `design.md` applies. | The part family as the heading. One large neutral figure plate with one diagonal proof crop borrowed from the catalogue card. Part numbers, compatibility and pricing on an opaque panel in the dialog’s reading order. The dialog’s specification list, pack choice and primary action. | Extension |
| Selection dialog | The approved selection dialog | Part number, quantity × unit price, line total, “Remove”, subtotal ex VAT, “Continue browsing”. | Approved. Extended as §4.4 lists. |
| `/checkout` | None | A section heading. A form in the catalogue field pattern with visible labels and native selects. The order summary follows it on mobile and sits to its right on desktop. One primary action with the hatched end cap. An underlined secondary link back to the selection. | Extension |
| `/checkout/success` | None | A single column: overline, section heading, a description list for the order reference, dispatch date and delivery, a read-only order summary and a secondary link. “Confirming payment” is a text status in a polite live region. | Extension |
| `/sample-pack`, `/trade` | None | A section heading and short intro, a form in the field pattern, one primary action. Confirmation and pending states are stated in text. | Extension |
| `/account` | None | Fine-ruled rows in the material-index pattern, with the name on the left and figures in mono on the right, for orders and invoices. Description lists for credit, balance and PO references. | Extension |
| `/admin` | None | The same tokens, themes, type, fields, buttons, ruled rows and description lists. No hero, proof or material artwork. Dense tables are acceptable. | Extension |

### 4.3 Product dialog and product page

A catalogue card represents one family. It stays a whole-card button that opens the approved product dialog. The page at `/blades/[slug]` must also exist, one per family, because this section and §6 require indexable product content, metadata and structured data. The dialog and the page show the same product drawing or neutral part-code plate and link to the photograph when one exists. Show the part code, product name, machine and OEM reference, tool fit, compatible materials, availability and dispatch, variant, quantity, per-unit price and total, then the primary action “Add to selection”.

A family with more than one variant needs a control the pack does not show. Use a row of adjacent rectangular buttons in the pack-choice pattern, with the pressed option hatched. Label each with the angle, shank or holder that tells the variants apart, and place the row before the quantity. An exact code match opens with its variant chosen. Where a code has several valid configurations, nothing is preselected, and a line of text asks for a choice before “Add to selection” becomes available.

How the dialog and the page connect is open question 1 in §4.6.

### 4.4 Extensions the behaviour requires

Each row is a requirement of this document that the approved design does not show. The behaviour stands. Build it in the design’s language as described.

| Requirement | What the design shows | Required extension |
| --- | --- | --- |
| VAT-inclusive price beside the business price (§3) | The ex-VAT price only, as “£22.50 ex VAT / ea” | The ex-VAT price leads in the approved format. Follow it with the VAT-inclusive figure and rate in the muted text tone on the same neutral field, as “£27.00 inc VAT (20%)”. On a card it takes its own line below the ex-VAT price. In the product detail, five EDG-Z10 show “£99.75”, “£19.95 each · ex VAT” and “£119.70 inc VAT (20%)”. The selection and checkout add right-aligned rows under the subtotal for delivery, VAT at the applied rate and the total including VAT. |
| Tool categories across the range (this section, Appendix A) | A native select with “All tool types”, “Drag”, “Oscillating”, “Rotary” | Keep the native select and “All tool types”. List one option, in sentence case, for each tool category that has a published variant. The range adds kiss-cut, V-cut, tangential and roll-plotter blades. Options come from catalogue data. |
| Substrates across the range | Three material-index rows: Corrugated board, Vinyl, Textile | One row per substrate that has a published variant, in the approved row pattern: swatch, plain name, matching count in mono. Each new swatch follows “A new material” in `design.md`. The missing artwork is open question 4. |
| Browse verified machine brands (this section) | No control | A second native select in the tool-type field pattern, opening on “All machines” and listing only brands with a verified mapping. It stacks with the other controls on narrow screens. |
| Stock status and dispatch date (§2, §3) | Neither | Show “Availability” in the product detail. Show “Dispatch” when a current date is available. The selection, checkout and confirmation repeat the dispatch date when available. Show estimated delivery separately only when there is a destination estimate or a buyer action to take. |
| Availability without colour | The design has no colour-coded interface. Selection state uses hatching, a border and a visible name. | Availability is always stated in words. An out-of-stock variant keeps its label and adds “Out of stock” to it. Buyers can still select it to see its fit, specifications and prices, including on a direct visit. Disable “Add to selection” and say why beside the action. Never signal availability by colour or opacity alone. On a reorder, an unavailable item is marked “Out of stock” in words. Only a basket actually corrected for stock (§7) says it removed an item, announced in a polite live region in the selection. |
| Any whole quantity, with breaks at 5 and 10 (§3, §7) | Three pack-choice buttons: 1, 5, 10 | Keep the three buttons as shortcuts to the price-break quantities. Add a labelled numeric quantity field in the field pattern so a buyer can order any whole number. Unit and total prices update together. Selection lines let the buyer change a quantity. The saving prompt in §3 is a line of plain text under the total. |
| Labelled Finder results and unmatched codes (§2) | Typing filters the cards. A zero-result panel offers “Show all blades”. | Mark each result “Exact match” or “Suggested” in the mono overline style. Show the machine, holder, angle or shank that tells similar results apart in the card’s text panel. The zero-result panel replaces the demo copy, makes “Ask us to match this blade” its primary action, carrying the query, and keeps “Show all blades” as the route back. |
| Progress to free delivery (§3) | Nothing | One sentence on the ex-VAT basis in the selection and at checkout, such as “£50.25 more ex VAT for free delivery”. No coloured bar. |
| Checkout from the selection | The selection ends with a demo notice and “Continue browsing” | Remove the demo notices from the product detail, the selection and the footer credit. Add a primary action with the hatched end cap, “Go to checkout”, above “Continue browsing”. The footer credit row carries the business contact and privacy links that §8 requires. |
| Forms on extension screens | A labelled search field and a native select | Every input has a visible label. State errors in words next to the field and associate them with it. Do not mark an error by colour alone. |
| Stored selection | Quantities kept in the browser under `edgey-storefront-selection-v1` | Store variant IDs and quantities only. Prices, stock and totals always come from the server (§3). |

### 4.5 Accessibility, responsive layout, theme and motion

“Accessibility and motion”, “Layout and responsive behaviour” and “Theme behaviour” in `design.md` apply to every route, extensions included. In particular:

- Real links for destinations, buttons for actions, labelled inputs, native selects and named native dialogs. A skip link is the first keyboard destination. The `/` shortcut reaches catalogue search as specified.
- A visible focus ring in both themes, which survives every dialog close and filter update. Result counts are announced in a polite live region.
- Every route works from 1440 px down to 320 px with no horizontal scrolling, using the pack’s breakpoints. Check longer product names, enlarged browser text and a selection containing several items.
- The first visit is dark. The explicit choice persists under `edgey-theme`, is applied before first paint and still works for the current page when storage is unavailable.
- With `prefers-reduced-motion: reduce`, remove transitions and scroll immediately.
- Extension screens use the pack’s named text and surface pairs, so its measured contrast holds. Sample any new text placed over artwork.

### 4.6 Open UI questions

Neither document settles these. Each has a recommendation. None blocks the catalogue and database work in §8.

1. **How do the product dialog and the product page connect?** Recommendation: a card opens the dialog as approved and the address becomes `/blades/[slug]`, so the view can be shared and Back closes it. A direct visit to that address shows the full page.
2. **Where does “Blade catalogue” in the masthead go, and does `/` list the whole range?** Recommendation: `/` shows the full published catalogue below the hero, as designed. `/blades` is the same catalogue without the hero. The link scrolls on `/` and opens `/blades` elsewhere.
3. **“Pack quantity” or “Quantity”?** The design labels the control “Pack quantity”. §2 says five and ten are quantities of the same blade, not packs. Recommendation: label it “Quantity”.
4. **Who supplies the missing artwork?** The pack has four line drawings, four illustrative photographs and three substrate swatches. The range has 26 families, more tool types and more substrates. Recommendation: the design owner supplies drawings and swatches under “A new illustration” and “A new material”. Until then a family without its own drawing shows the neutral figure plate with its part code and no proof crop, and no illustrative photograph stands in for a different blade.
5. **What are the product display names?** The demo uses plain names such as “Flat-stock drag blade”. Appendix A has model references and applications. Recommendation: the catalogue owner writes a sentence-case plain name for each family in the demo’s style, and the machine reference stays in the specification list.
6. **Which availability words, and are counts shown?** Recommendation: “In stock” and “Out of stock” only, with no stock counts.
7. **“Before VAT” or “ex VAT” in the saving prompt?** §3 quotes “Add one blade and save £4.55 before VAT”. The design’s price language is “ex VAT”. Recommendation: “Add one blade and save £4.55 ex VAT”.
8. **Who approves the extension screens?** They have no approved reference. Recommendation: the owner of the design pack reviews staging screenshots of each extension in both themes before the first live release.

## 5. Order, stock and credit rules

**Order creation.** On checkout, validate the submitted variant IDs and positive whole quantities, recalculate prices and delivery, and require complete contact and shipping details. Create the pending order, its immutable line snapshots and stock reservations together in one database transaction. Repeated submission of the same checkout attempt returns the same order. A material basket or address change starts a repriced attempt after the old payable attempt is closed. The server associates the chosen payment method and Stripe object IDs with that order.

| Flow | Sequence and recovery |
| --- | --- |
| Guest card or wallet | Create a hosted Stripe Checkout Session for the reserved order using a stable idempotency key. Offer card and eligible Apple Pay or Google Pay wallets. Use the delivery address already validated by Edgey. Carry the Edgey order ID into Stripe and enable invoice creation. When Stripe confirms payment, reconcile amount and currency, record the invoice reference when available and release the order to the picking queue. |
| Abandoned or interrupted checkout | Align the reservation expiry with the Checkout Session expiry. Confirm the session has expired or has been explicitly closed before releasing stock. If creation times out or payment and expiry events cross, retrieve the provider state and resolve the existing attempt. Route unresolved cases to staff. |
| Approved Net 30 | Require an authenticated approved account, billing and delivery details, a non-empty PO and available credit for the **gross** total. Reserve stock and credit together before calling Stripe. Create a `send_invoice` invoice due in 30 days using the order ID and PO. Finalise and send it once. On confirmed issue, convert the credit hold to outstanding debt and authorise dispatch. On an ambiguous result, reconcile the same invoice before retrying. Release unused holds once the provider confirms no collectible invoice remains. |
| Settlement and recovery | Apply each payment, partial payment, credit note, void or refund to the matching order and invoice. Reconcile outstanding exposure against the invoice amount remaining. Overdue balances enter a finance follow-up queue. Keep card invoices out of the trade-credit ledger. Finance sets the policy for suspending overdue accounts. |
| Cancellation and returns | Before dispatch, cancel picking, release allocations and reconcile the refund or invoice void. After dispatch, record a return against the original lines. Staff inspect received units and explicitly restore saleable stock. A refund alone never adds physical stock. |

**Three quantities have different meanings.** On-hand stock counts physical blades. Reserved stock includes units held for an open checkout or allocated to an accepted order. Available stock is on-hand less reserved. Payment or trade authorisation retains the allocation. Dispatch reduces on-hand and the allocation together, once. The same rules apply to approved trial packs. Reserving, cancelling and dispatching must enforce non-negative availability under concurrent use.

**Warehouse receipts and adjustments.** Record a delivery against its exact SKU. Use a signed adjustment for damage, loss, a sample, a count correction, a return to the supplier or another reason. “Other” requires a note. Positive adjustments use count correction or other; a physical delivery uses Receive stock. Adjustments never consume reserved units and serialize with checkout and trial movements. Each entry records staff and time; correct mistakes by posting another movement, not by editing the ledger.

**Payment and fulfilment are independent.** Keep payment states for pending, invoiced, partially paid, paid, voided, partially refunded and refunded. Track fulfilment separately through awaiting authorisation, ready to pick, picking, dispatched and cancelled, with returns recorded against dispatched lines. A Net 30 order can be dispatched and unpaid for 30 days. Recording payment later must preserve its tracking and dispatch date.

**Ownership of updates.** Verified Stripe webhooks and a server-side reconciliation job using Stripe’s API confirm financial facts. Warehouse actions own picking and physical stock movements. Persist incoming events, apply each financial effect once per order/provider operation and make retries safe even when separate events describe the same outcome. Send confirmations from a durable queue with a unique order/message key. Staff can see and replay failed operations. [Stripe event delivery](https://docs.stripe.com/webhooks) · [Stripe request idempotency](https://docs.stripe.com/api/idempotent_requests)

## 6. Engineering contract

Use Next.js App Router with strict TypeScript, Tailwind, Lucide, Supabase Postgres/Auth and Vercel. Use Stripe-hosted Checkout and Stripe Invoicing. Configure Tailwind from `design-tokens.json` and the type stacks in `design.md`. Use the design pack’s SVG masters and its drawn icons where it supplies them, and Lucide only for icons it does not supply. Pin supported package and Stripe API versions in the implementation. Serve indexable product content with revalidation on publication changes. Recheck live prices, publication and stock on every checkout.

| Data or endpoint | Minimum contract |
| --- | --- |
| Catalogue | Products contain the family ID, slug, category, description and media. Variants have unique SKU, supplier identifier, verified specifications, pricing tiers, opening stock and publication status. Compatibility records link variant, OEM code, brand, machine, tool and adapter with evidence and verification state. |
| Prices and cost | Keep selling and landed amounts in integer GBP pence, and supplier prices in integer minor units of GBP, USD or EUR. Price history records old and new tiers, actor and time. Store receipt costs separately from catalogue and stock rows, keyed to the receipt movement and variant. The current landed cost is the latest costed receipt, including any correction, or the latest variant estimate before a costed receipt exists. An uncosted receipt does not replace it. This is a margin reference, not weighted inventory valuation or historical cost of goods sold. Estimate changes and receipt corrections record old and new values, actor and time. Authorised catalogue or finance sessions alone can read them; public and buyer records and APIs do not carry cost or margin. |
| Search | `search_blades(query_text)` uses a normalised exact-code index, then ranked text matching with `pg_trgm`. Public reads return approved records for published variants only. |
| Orders | Orders record the buyer or guest, contact and validated address snapshot, payment method and status, fulfilment status, totals and tax, promises, provider IDs, PO and tracking. Order items snapshot variant SKU, fit or option label, quantity and unit price. Preserve historical details when the catalogue changes. |
| Stock and credit | Store reservations and auditable stock movements per variant. Track credit limits, temporary holds and outstanding invoices per trade account. Apply stock and credit changes transactionally with unique operation keys. Keep invoice, credit and movement history for reconciliation. |
| Requests and access | Store trial requests separately from approved fulfilment details. A validated server action creates a new request from permitted fields and rate-limits submissions. Enforce row-level security on all exposed tables, including order items through their parent order. Public users see published catalogue data. Authenticated buyers see their own orders, invoices and account. Staff roles are assigned server-side. Approval, credit and service-role credentials remain server-only. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) |
| Checkout endpoints | `POST /api/checkout/session` and `POST /api/checkout/net30` share the pricing, availability and delivery rules. The request carries variant IDs, quantities, contact/delivery data and an attempt token. Net 30 also requires a PO. Prices, permissions, balances and approval come from the server. |
| Stripe and operations | `POST /api/webhooks/stripe` verifies the signature against the raw body. Persist event identity before acknowledging durable receipt. Reconcile pending orders and invoices after interruptions, and surface mismatches, unsent confirmations and overdue accounts to staff. |
| Environments | Local and staging use test Stripe credentials, isolated Supabase data and test email recipients. Production has separate DB, webhook secret, tax rate, email sender and carrier settings. Store secrets in deployment configuration. Supply versioned migrations, a repeatable seed and a documented command for the acceptance suite. |

## 7. Acceptance tests

Use these as release evidence alongside typecheck and build. The product owner supplies representative OEM packets. The fulfilment owner checks what appears on the picking screen. The last row is the release evidence for UI.

| Scenario | Pass condition |
| --- | --- |
| Exact, ambiguous and unknown searches | A verified code returns the right variant first across case and punctuation. Shared configurations require a choice. An unknown code opens a prefilled enquiry. Searching `5201345` never labels it as Z71. |
| Variant isolation | Sell out of one plotter angle or shank. The correct variant becomes unavailable, its sibling remains available, and a stale basket is corrected before payment. Mixed variants never share a quantity discount. |
| Price and tax | Test quantities 1, 4, 5, 9 and 10, including duplicate lines for one variant. The Z10 examples in §3 match basket, Stripe and invoice. A £149.99 goods subtotal incurs £6.95 delivery and £150.00 qualifies for free delivery in the standard service area. |
| Guest purchase | A guest supplies a valid address, pays by card and receives one confirmation and invoice. The pick list shows the paid SKU, quantity, recipient and service. Refreshing the success page has no side effects. Test eligible wallets on supported devices and the card fallback. |
| Concurrent stock and provider retries | With one blade available, two buyers start checkout. Only one gets a payable reservation. After confirmed expiry it becomes available again. Repeated submissions, duplicate events and events received out of order produce one order, one allocation and one confirmation. |
| Staff prices, costs and stock | Save pound-denominated tiers and see per-blade VAT and margin. Record an estimate, then a costed receipt, and check that the receipt becomes the current cost. Guests, buyers and warehouse-only staff cannot read costs. A signed adjustment records its reason and leaves order and trial reservations intact. |
| Staff sales reporting | Compare current and previous UK date ranges, including a daylight-saving boundary. Check that the summary, product rows and daily CSV reconcile, refunds appear on their own dates, and a missing cost is visible to finance. Warehouse and catalogue exports omit margin; buyers and anonymous visitors cannot access the page, exports or report RPC. Use the guarded staging fixture to verify realistic sales and reversible stock changes without contacting providers. |
| Concurrent trade orders | With £200 of credit available, submit two £120 gross orders together. At most one is authorised. Simulate a timeout after invoice creation and retry. One invoice, one PO-linked order and one £120 exposure remain. Unapproved and over-limit buyers cannot use account terms. |
| Dispatch then settlement | Dispatch a Net 30 order, then partially pay and settle its invoice. Tracking and dispatch history persist. The outstanding balance reduces by the amounts actually settled. Cancelling an undispatched order or refunding a dispatched one follows the stock rules in §5. |
| Isolation and trials | A buyer cannot read another buyer’s order lines or invoice or change their credit limit. A trial can be requested with five fields, dispatched only with two allocated units and a complete deliverable address, and linked to a subsequent order. |
| Delivery promises | Exercise 15:29 and 15:30 in UK local time, a Friday, a bank holiday and an unsupported postcode. Checkout, confirmation and picking show the same dispatch date and agreed service. |
| Visual acceptance | Run the visual acceptance pass in `design.md` against the staging build, with `Edgey-preview.html` open beside it, in both themes at 1440, 390 and 320 px. Every row passes on `/`, with seeded staging data standing in for the demo’s cards and counts. Repeat the theme, keyboard, focus, reduced-motion and horizontal-scroll checks on every other route in §4.2. Keep screenshots and list each deliberate departure from the approved design. The only accepted departures are the extensions in §4.4 and the answers to §4.6. |

## 8. Release decisions and build order

| Owner | Decision or evidence required | When |
| --- | --- | --- |
| Catalogue owner | Approve supplier evidence for every published variant and alias, enter opening stock, and confirm the physical pick label. Keep additional variants in draft as they are verified. | Before publishing each variant |
| Commercial and finance owners | Confirm the ex-VAT matrix, all-units discounts, supplier margin after free delivery, VAT status and invoice details. Approve customer-facing terms and returns process. | Before live payment |
| Fulfilment owner | Confirm the courier contract, cut-off, postcode coverage, holiday calendar, packaging and trial eligibility. Confirm applicable remote-sale, age and delivery requirements for the actual products and destinations with Trading Standards or a qualified adviser, and implement any required checks for orders and samples. [Government guidance](https://www.gov.uk/government/publications/the-offensive-weapons-act-2019) · [2026 Act factsheet](https://www.gov.uk/government/publications/crime-and-policing-act-2026-factsheets/crime-and-policing-act-2026-knife-crime-and-crossbows-factsheet) | Before opening the affected sale or dispatch route |
| Operations owner | Confirm who picks, replies to unmatched searches, approves samples and handles failed or returned orders. Publish business contact details and privacy information, and set retention periods for enquiries and applications. | Before accepting public submissions |
| Finance owner | Set initial credit limits, account approval and suspension rules, and responsibility for overdue invoices and reconciliation. Test a complete 30-day invoice lifecycle in staging. | Before enabling Net 30 |

Build the catalogue and database permissions first, then the Finder and product pages. Add the basket, shared pricing and test-mode card payment before connecting picking and dispatch. Complete the two enquiry flows, trial fulfilment and trade application for the first live release. Deliver the trade account portal and credit checkout once finance has exercised the invoice lifecycle.

## Appendix A. Draft range and price book

The first inventory order covers 32 physical variants. Three unordered variants are retained in draft, for 35 variants across 26 families. Each row is one SKU with its own stock balance. The local catalogue seed starts every SKU as **draft, zero stock**. The separate staging fixture uses invented approvals and stock for testing. Neither the order nor this appendix authorises publication.

Prices are GBP per blade excluding VAT. Each tier applies to quantities of the same SKU. Existing Appendix A prices carry forward, including for the two angles already listed for each Graphtec holder. The owner accepted the prices for EDG-SUM-9802, EDG-SUM-9803 and EDG-DF113 on 21 November 2026; approval and publication remain separate.

Luke supplied the ordered specifications on 21 November 2026. Their original source and the replacement fit are unverified. Verify the packet and fit in the named tool before approving a public mapping under §2. The listed cross-references are candidates, not evidence of interchangeability.

### Zünd and Summa flatbed

| SKU | Product and option | Reference codes | Compatible machines and tools | Type and angle | Dimensions and depth or offset | 1–4 | 5–9 | 10+ |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| `EDG-Z10` | Flat-stock drag blade | `Z10`, `3910301` | Zünd G3, S3, L3, D3, PN (UCT, SCT); JWEI / iEcho (50mm holders) | Double-edge flat drag · 50° | 50 × 8 × 1.5 mm · Max depth 4.8 mm | £22.50 | £19.95 | £17.50 |
| `EDG-Z11` | Tight-corner drag blade | `Z11`, `3910309` | Zünd G3, S3, L3, D3, PN (UCT, SCT); JWEI / iEcho (50mm holders) | Double-edge flat drag · 60° | 50 × 8 × 1.5 mm · Max depth 6.9 mm | £22.50 | £19.95 | £17.50 |
| `EDG-SUM-9802` | Short flat-stock drag blade | `500-9802`, `BLD-DF112` | Summa F-Series (F1612, F1330, F1832, F3220) Double-Edge Cutout Tool; Esko BLD-DF112 | Double-edge flat drag · 50° | 25 × 8 × 1.5 mm · Max depth 4.8 mm | £20.95 | £18.50 | £15.95 |
| `EDG-SUM-9803` | Short tight-corner drag blade | `500-9803` | Summa F-Series (F1612, F1330, F1832, F3220) Double-Edge Cutout Tool | Double-edge flat drag · 60° | 25 × 8 × 1.5 mm · Max depth 6.5 mm | £20.95 | £18.50 | £15.95 |
| `EDG-Z46` | Heavy drag blade | `Z46`, `3910328`, `500-9807` | Zünd G3, S3, L3 (UCT, SCT); Summa F-Series (500-9807 Heavy-Duty Cutout) | Single-edge heavy drag · 45° | 50 × 6 × 1.5 mm · Max depth 20.0 mm | £36.50 | £32.50 | £28.50 |
| `EDG-Z16` | Oscillating blade | `Z16`, `3910306`, `BLD-SF216` | Zünd G3, S3, L3 (EOT, POT, UCT); Esko Kongsberg (BLD-SF216 adapter); Lectra | Pointed flat oscillating/drag · 54° | 26 × 5.6 × 0.63 mm · Max depth 7.4 mm | £21.50 | £18.50 | £15.95 |
| `EDG-Z17` | Tight-radius oscillating blade | `Z17`, `3910307`, `BLD-SF217` | Zünd G3, S3, L3 (EOT, POT, UCT); Esko Kongsberg (BLD-SF217 adapter) | Pointed flat oscillating/drag · 65° | 25 × 5.6 × 0.63 mm · Max depth 12.0 mm | £21.50 | £18.50 | £15.95 |
| `EDG-Z20` | Detail oscillating blade | `Z20`, `3910313`, `500-9811`, `SF427` | Zünd G3, S3, L3 (EOT, POT); Summa F-Series (500-9811 EOT); Kongsberg (SF427) | Pointed oscillating · 63° / 84° | 25 × 4 × 0.63 mm · Max depth 14.3 mm | £23.50 | £20.50 | £18.00 |
| `EDG-Z21` | Fluted-board oscillating blade | `Z21`, `3910314`, `500-9812` | Zünd G3, S3, L3 (EOT, POT); Summa F-Series (500-9812 EOT) | Pointed oscillating · 63° / 84° | 28 × 4 × 0.63 mm · Max depth 17.2 mm | £24.50 | £21.50 | £18.95 |
| `EDG-Z28` | Long oscillating blade | `Z28`, `3910318`, `500-9814` | Zünd G3, S3, L3 (EOT, POT); Summa F-Series (500-9814 EOT) | Long-reach pointed oscillating · 45° / 86° | 38 × 4 × 0.63 mm · Max depth 26.0 mm | £31.50 | £27.50 | £24.50 |
| `EDG-Z71` | V-cut blade | `Z71`, `3910334`, `500-9826` | Zünd G3, S3, L3 (VCT V-Cut Tool); Summa F-Series (500-9826 V-Cut Tool) | V-Cut bevel blade · 90° (for 0°–45° V-cut heads) | 50 × 8 × 1.5 mm · Max depth 16.0 mm | £34.50 | £30.50 | £27.00 |
| `EDG-Z50` | Decagonal rotary blade | `Z50`, `3910335`, `500-9860` | Zünd G3, S3, L3 (DRT, PRT Driven/Power Rotary); Summa F-Series (500-9860 Rotary) | Decagonal (10-sided) rotary blade | Ø25 mm OD × Ø8 mm bore × 0.63 mm · Max depth 3.5 mm | £38.00 | £34.00 | £30.00 |
| `EDG-Z52` | Large decagonal rotary blade | `Z52`, `3910337`, `500-9862` | Zünd G3, S3, L3 (DRT, PRT Driven/Power Rotary); Summa F-Series (500-9862 Rotary) | Decagonal (10-sided) rotary blade | Ø32 mm OD × Ø8 mm bore × 0.63 mm · Max depth 7.0 mm | £44.00 | £39.00 | £35.00 |
| `EDG-Z1` | Kiss-cut blade | `Z1`, `3910110` | Zünd G3, S3, L3 (KCT, KCM-S, C2 Kiss-Cut Tools) | Round-shank kiss-cut drag · 35° (standard vinyl) | Ø3 mm shank × 18.5 mm · Max depth ~1.0 mm | £9.95 | £8.50 | £7.50 |
| `EDG-Z2` | Thick-vinyl kiss-cut blade | `Z2`, `3910115` | Zünd G3, S3, L3 (KCT, KCM-S, C2 Kiss-Cut Tools) | Round-shank kiss-cut drag · 35° (thicker/reflective vinyl) | Ø3 mm shank × 18.5 mm · Max depth ~1.5 mm | £9.95 | £8.50 | £7.50 |

### Kongsberg

| SKU | Product and option | Reference codes | Compatible machines and tools | Type and angle | Dimensions and depth or offset | 1–4 | 5–9 | 10+ |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| `EDG-SR6223` | Round-shank blade | `BLD-SR6223`, `G42437293` | Kongsberg X, XN, XL, XP, C, XE, V (HF VibraCut, MP HF, Oscillating w/ 6mm adapter) | Single-edge 6mm round-shank oscillating · 66° cut / 24° tip | Ø6 mm shank × 39 mm × 0.64 mm · Max depth 12.0 mm (single/double-wall corrugated) | £25.50 | £22.50 | £19.95 |
| `EDG-SR6224` | Reinforced round-shank blade | `BLD-SR6224`, `G42438135` | Kongsberg X, XN, XL, XP, C, XE, V (HF VibraCut, MP HF, Oscillating w/ 6mm adapter) | Single-edge 6mm round-shank oscillating · 66° cut / 24° tip (stiffer profile for tough/recycled board) | Ø6 mm shank × 39 mm × 0.64 mm · Max depth 12.0 mm | £26.50 | £23.50 | £20.95 |
| `EDG-SR6310` | Long-reach round-shank blade | `BLD-SR6310`, `G42441626` | Kongsberg X, XN, XL, XP, C (HF VibraCut, MP HF, Long Stroke w/ 6mm adapter) | Single-edge 6mm round-shank oscillating · 79° cut / 11° tip | Ø6 mm shank × 39 mm × 0.64 mm · Max depth 20.0 mm (triple-wall corrugated, Re-board) | £30.50 | £27.00 | £24.00 |
| `EDG-SR6315` | Slender round-shank blade | `BLD-SR6315`, `G42449504` | Kongsberg X, XN, XL, XP, C (HF VibraCut, MP HF, Long Stroke w/ 6mm adapter) | Slender single-edge 6mm round-shank oscillating · 75° cut / 15° tip (tight arcs / low overcut) | Ø6 mm shank × 39 mm × 0.60 mm · Max depth 14.0 mm (foam board, PVC, corrugated) | £28.50 | £25.00 | £22.00 |
| `EDG-DF113` | Flat drag sword knife | `BLD-DF113`, `G42443036` | Kongsberg X, XN, XL, XP, C, V (Static Knife Tool, Heavy Duty Knife) | Double-edge flat drag sword knife · 60° | 50 × 8 × 1.5 mm · Max depth 6.5 mm (vinyl, carton, styrene, banner) | £21.50 | £18.95 | £16.50 |

### Roll plotters

| SKU | Product and option | Reference codes | Compatible machines and tools | Type and angle | Dimensions and depth or offset | 1–4 | 5–9 | 10+ |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| `EDG-MIM-A45` | Mimaki-pattern plotter blade, 45° | Part number not supplied | Mimaki CG-SRIII, CG-AR, CG-FXII, CJV150 / CJV300, UCJV series | Standard vinyl drag blade · 45° | Ø1.5 mm × 20 mm · 0.25–0.30 mm offset | £11.95 | £9.00 | £7.50 |
| `EDG-MIM-A60` | Mimaki-pattern plotter blade, 60° | Part number not supplied | Mimaki CG-SRIII, CG-AR, CG-FXII, CJV150 / CJV300, UCJV series | Thick/reflective/flock drag blade · 60° | Ø1.5 mm × 20 mm · 0.50 mm offset | £11.95 | £9.00 | £7.50 |
| `EDG-ROL-A45` | Roland-pattern plotter blade, 45° | Part number not supplied | Roland VersaCAMM, TrueVIS, CAMM-1 (GS-24, GR2, GX series); Mutoh; GCC | Standard vinyl drag blade · 45° | Ø2.0 mm × 23.5 mm · 0.25 mm offset | £11.50 | £8.50 | £7.00 |
| `EDG-ROL-A60` | Roland-pattern plotter blade, 60° | Part number not supplied | Roland VersaCAMM, TrueVIS, CAMM-1 (GS-24, GR2, GX series); Mutoh; GCC | Thick/reflective/sandblast drag blade · 60° | Ø2.0 mm × 23.5 mm · 0.25 mm offset | £11.50 | £8.50 | £7.00 |
| `EDG-SUM-DRG-36` | Summa-pattern drag plotter blade, 36° | `391-360` | SummaCut, Summa S Class 2 / 3 D-Series (Drag) & Summa F-Series Drag Module | Standard vinyl drag blade · 36° | Ø1.5 mm × 19 mm · Max depth 0.25 mm | £11.95 | £9.00 | £7.50 |
| `EDG-SUM-DRG-60` | Summa-pattern drag plotter blade, 60° | `391-231` | SummaCut, Summa S Class 2 / 3 D-Series (Drag) & Summa F-Series Drag Module | Thick/reflective/flock drag blade · 60° | Ø1.5 mm × 19 mm · Max depth 0.60 mm | £11.95 | £9.00 | £7.50 |
| `EDG-SUM-TAN-36` | Tangential plotter blade, 36° | `390-534` | Summa S Class 2 / 3 T-Series (Tangential) & Summa F-Series Tangential Module | Standard tangential knife · 36° | Ø2.5 mm × 31 mm · Max depth 0.25 mm | £19.50 | £17.00 | £14.95 |
| `EDG-SUM-TAN-45` | Tangential plotter blade, 45° | `390-560` | Summa S Class 2 / 3 T-Series (Tangential) & Summa F-Series Tangential Module | Wedge tangential knife · 45° (40°/25°) | Ø2.5 mm × 31 mm · Max depth 1.00 mm | £19.50 | £17.00 | £14.95 |
| `EDG-GRP-CB09-45` | Graphtec-pattern plotter blade, CB09 holder · 45° | `CB09U` | Graphtec CE6000, CE7000, CE8000, FC8600, FC9000 (PHP33-CB09N-HS blue holder) | Standard vinyl drag blade · 45° | Ø0.9 mm × 19 mm · 0.25 mm offset | £11.95 | £9.00 | £7.50 |
| `EDG-GRP-CB09-60` | Graphtec-pattern plotter blade, CB09 holder · 60° | `CB09U` | Graphtec CE6000, CE7000, CE8000, FC8600, FC9000 (PHP33-CB09N-HS blue holder) | Small lettering / thick vinyl drag · 60° | Ø0.9 mm × 19 mm · 0.25 mm offset | £11.95 | £9.00 | £7.50 |
| `EDG-GRP-CB15-45` | Graphtec-pattern plotter blade, CB15 holder · 45° | `CB15U` | Graphtec FC8600, FC9000, CE7000/CE8000 (PHP33-CB15N-HS red holder) | Heavy-duty vinyl/reflective drag · 45° | Ø1.5 mm × 19 mm · 0.25 mm offset | £11.95 | £9.00 | £7.50 |
| `EDG-GRP-CB15-60` | Graphtec-pattern plotter blade, CB15 holder · 60° | `CB15U` | Graphtec FC8600, FC9000, CE7000/CE8000 (PHP33-CB15N-HS red holder) | Heavy-duty reflective/sandblast drag · 60° | Ø1.5 mm × 19 mm · 0.25 mm offset | £11.95 | £9.00 | £7.50 |

### Unordered drafts retained

| SKU | Product and option | Legacy references and application to verify | 1–4 | 5–9 | 10+ |
| --- | --- | --- | ---: | ---: | ---: |
| `EDG-HTR040` | Circular rotary blade | DYSS `HTR-040`, `DYSS-40MM`; 40 mm rotary for textiles, flag fabric and soft signage | £39.50 | £35.00 | £31.00 |
| `EDG-MIM-A30` | Mimaki-pattern plotter blade, 30° | `SPB-0030` and `MD300V` are legacy candidates not mapped to an angle | £11.95 | £9.00 | £7.50 |
| `EDG-ROL-A30` | Roland-pattern plotter blade, 30° | `ZEC-U1005` and `ZEC-U5025` are legacy candidates not mapped to an angle | £11.50 | £8.50 | £7.00 |

### Checks before publication

- Keep Zünd Z10/Z11 (50 mm) and Summa 500-9802/500-9803 (25 mm) on four different SKUs. DF113 is stated equivalent to Z11, but its stated depth is 6.5 mm rather than 6.9 mm. Keep separate stock and do not give DF113 a Z11 Finder mapping.
- The owner-supplied Zünd item numbers replace the old working references. In particular, do not map packet code `5201345` (Z60) to Z71. Verify conflicting Z71, Z1 and Z2 references against the actual packets and current OEM documentation before approval.
- Confirm whether Graphtec `CB09U` and the prior `CB09UB` reference denote the same blade or pack. Confirm the holder and angle for each of the four Graphtec SKUs. The code alone does not identify the angle.
- `BLD-SF216` and `BLD-SF217` identify adapters, so those rows are staff-only and not exact public blade matches. The owner lists `SF427` for Z20 as a cross-reference; verify its identity before approving it.
- Confirm the actual Mimaki and Roland OEM code and holder for each angle. The seed keeps the previous code candidates unverified; the owner supplied brand, angle and compatible machines, not a confirmed code for an individual option.
- Use the existing neutral plate for products without artwork. Receive only physically counted saleable blades against the confirmed SKU; do not enter order or staging-demo quantities as opening stock.

### Previous UK benchmarks (internal)

These buying estimates predate the order. Verify the listing, pack size and observation date before using them to set prices. Do not transfer Zünd benchmarks to the separate Summa flatbed variants or to DF113.

| Earlier family codes | Prior benchmark per blade |
| --- | ---: |
| Z10, Z11 | £28.00 |
| Z46 | £43.00 |
| Z16, Z17 | £24.00–£27.50 |
| Z20 | £27.50 (£55/2pk) |
| Z21 | £29.00 (£58/2pk) |
| Z28 | £36.50 (£73/2pk) |
| Z71 | £41.00 |
| Z50 | £45.00 |
| Z52 | £52.00 |
| Z1, Z2 | £11.50 (£23/2pk) |
| SR6223 | £30.00 |
| SR6224 | £30.00–£32.00 |
| SR6310 | £36.00 |
| SR6315 | £32.00–£35.00 |
| HTR040 | £45.00–£55.00 |
| Mimaki plotter | £13.55–£22.90 |
| Roland plotter | £13.55–£23.99 |
| Summa drag plotter | £13.55–£20.83 |
| Summa tangential | £22.60–£36.00 |
| Graphtec plotter | £13.55–£25.12 |
