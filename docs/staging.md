# Stand up and verify Edgey staging

Staging is for controlled testers, fake contact and delivery details, Stripe sandbox payments and test inboxes. It is not the live shop. Use a separate Vercel project, Supabase project, Stripe sandbox and Resend sender/key. Never connect this deployment to live data or publish the fixture as verified supplier stock.

## 1. Create the projects and choose the URL

1. Check out the commit you intend to stage. From the repository root, run `pnpm install --frozen-lockfile` with Node 24.
2. For a fresh setup, create an isolated Supabase project on Postgres 17 to match local development. Hosted staging uses the `edgey` project in Stockholm (`eu-north-1`). Use a dedicated project on Vercel Pro: Hobby cannot deploy the committed `vercel.json` with its [one-minute Cron schedules](https://vercel.com/docs/cron-jobs/usage-and-pricing). Use the Next.js preset and the repository root. The repository pins Node `24.x` in `engines.node`; the project setting alone did not prevent an earlier build resolving Node 26.
3. Use [`https://staging.edgey.site`](https://staging.edgey.site) as the fixed origin of `edgey-staging`. Attach only the staging subdomain; reserve `edgey.site` and `www.edgey.site` for the live shop. Use the **Production** environment of that *staging project*, not a Preview deployment: the fixed origin is needed for callbacks and Vercel only schedules Cron for Production deployments. Set [Vercel Deployment Protection](https://vercel.com/docs/deployment-protection#all-deployments) to **All Deployments** and grant access to approved testers. Standard Protection leaves the production domain public. Keep intake off during setup.

   Keep All Deployments protection on while staging includes rights-uncleared photography. The photo route checks the configured staging deployment and request origin, requires an authenticated catalogue staff session, and serves only draft variants. Published products and checkout never show uncleared photographs. Store those files only in the staging Supabase project's private `catalogue-review-photos` bucket without public read policies. Generate a fresh prefix with `openssl rand -hex 16`, upload the files as `<prefix>/<basename>` into that bucket, and set the prefix as the sensitive, server-only `EDGEY_STAGING_PHOTO_SET` in the staging project's Production environment. Leave it unset anywhere else. Do not commit the photographs or prefix to Git, put the prefix in the artwork manifest, or upload restricted photos to the live project.
4. Link `edgey-staging` to [`hey-winkin/edgey`](https://github.com/hey-winkin/edgey) in Vercel's Git settings. Set the Production branch to `main`, enable automatic Git deployments, and use the native project setting to disable Preview Deployments. Treat every merge to `main` as a staging deploy; verify the new commit in Vercel after merging. The first automatic deploy has not yet been observed. Keep Production credentials out of Preview; any future previews need isolated data and must not inherit the Production protection bypass. If you use the [Vercel CLI](https://vercel.com/docs/cli) for operator checks, verify that it is linked to the staging project.

## 2. Apply migrations, then load the test catalogue

Hosted staging already has the 36 migrations from the tested commit and 11 published variants. The initial load applied migrations in order and ran the seed and fixture as one guarded SQL transaction instead of using the importer. Do not rerun the fixture on that database.

For a fresh setup or a staged schema update, sign in with `pnpm exec supabase login` or inject `SUPABASE_ACCESS_TOKEN` from the operator's secret store. In the commands below, set `STAGING_PROJECT_REF` to the ref copied from the **staging** Supabase dashboard. Use the staging database password if prompted. Confirm the dry run lists the versioned migrations you expect before applying them. Apply and verify reviewed, backward-compatible migrations before merging app code that depends on them. A Vercel rollback does not undo a database migration, so split breaking schema changes into compatible steps.

```sh
pnpm exec supabase db push --remote="$STAGING_PROJECT_REF" --skip-vault --dry-run
pnpm exec supabase db push --remote="$STAGING_PROJECT_REF" --skip-vault
pnpm exec supabase migration list --remote="$STAGING_PROJECT_REF"
```

Do not pass `--include-seed`: the guarded import below runs the draft seed and publishes the test subset together. From **Connect** in the **staging** project's Supabase dashboard, choose one of these endpoints:

| Connection | When to use it | `EDGEY_STAGING_DB_URL` shape |
| --- | --- | --- |
| **Direct connection** | Your network can reach the direct host over IPv6, or the project has Supabase's direct IPv4 add-on. | `postgresql://postgres:<encoded-password>@db.<project-ref>.supabase.co:5432/postgres` |
| [**Session pooler**](https://supabase.com/docs/guides/database/connecting-to-postgres#pooler-session-mode) | Your network is IPv4-only and cannot reach the direct host. Copy the full `*.pooler.supabase.com` host from **Connect**; don't construct it from the region. | `postgresql://postgres.<project-ref>:<encoded-password>@<pooler-host>:5432/postgres` |

Load the URL into `EDGEY_STAGING_DB_URL` using your secret store, with the URL-encoded staging database password and no query string or fragment. For **either connection**, set `EDGEY_STAGING_DB_CA_FILE` to the local path of the **Server root certificate** (`prod-ca-2021.crt`) downloaded from the staging project's **Database Settings → SSL Configuration**. [Supabase's TLS example for the session pooler](https://supabase.com/docs/guides/database/psql#connecting-with-ssl) uses that same download. The scripts use the file to verify the server certificate and hostname, so don't add SSL parameters to the URL. They reject the transaction pooler on port `6543`, which doesn't preserve session state across transactions, as well as localhost and unverified TLS.

```sh
pnpm db:fixture:staging --project-ref "$STAGING_PROJECT_REF"
unset EDGEY_STAGING_DB_URL EDGEY_STAGING_DB_CA_FILE
```

The importer requires the explicit ref to match the direct host's project ref or the session pooler username's project ref. It refuses a database that already has catalogue, customer intake, order or Auth user rows. That makes it a one-time bootstrap for a fresh migrated project, not a way to restore sold stock or rerun fixtures in an existing project. For local development, `pnpm db:reset && pnpm db:env && pnpm db:fixture` is repeatable; `db:reset` wipes local data and `db:fixture` refuses non-local addresses. For subsequent staging sessions, receive stock through the staff desk or use a fresh, isolated project; never reset a hosted database to rerun a test.

The first four design products use Appendix A prices, not the portable demo's data. Check these names and per-unit prices excluding VAT at 1–4 / 5–9 / 10+ units:

| SKU | Name | Prices |
| --- | --- | --- |
| EDG-Z10 | Flat-stock drag blade | £22.50 / £19.95 / £17.50 |
| EDG-Z16 | Oscillating blade | £21.50 / £18.50 / £15.95 |
| EDG-SR6223 | Round-shank blade | £25.50 / £22.50 / £19.95 |
| EDG-Z50 | Decagonal rotary blade | £38.00 / £34.00 / £30.00 |

### Sync the real draft catalogue to an existing database

Use `catalogue:sync` for existing staging and for a future live database (including an empty first launch). **Never run the development seed, the test fixture, `db:reset`, or `db push --include-seed` on the live database or on the current populated staging database.** Apply all reviewed migrations first, including `20261121001600_catalogue_sync_baselines.sql`. That migration adds an empty, private record of what the sync creates; it changes no existing catalogue rows and requires no storefront release.

For the current staging project, copy **Connect → Session pooler** from its Supabase dashboard. Set `EDGEY_STAGING_DB_URL` privately to `postgresql://postgres.izmtnngzueyuwfwsztzd:<encoded-password>@<pooler-host>:5432/postgres` (copy the full host; don't guess it). Set `EDGEY_STAGING_DB_CA_FILE` to the dashboard's downloaded server root certificate as above. For a future live project, use that project's own ref, URL and CA; `--staging` selects the verified hosted connection mode, not a check that the project is named staging.

```sh
export STAGING_PROJECT_REF=izmtnngzueyuwfwsztzd
pnpm catalogue:sync --staging --project-ref "$STAGING_PROJECT_REF"
# Review the plan before running this separately:
pnpm catalogue:sync --staging --project-ref "$STAGING_PROJECT_REF" --apply
# Repeat the dry run to confirm there are no remaining adds or updates.
pnpm catalogue:sync --staging --project-ref "$STAGING_PROJECT_REF"
unset EDGEY_STAGING_DB_URL EDGEY_STAGING_DB_CA_FILE STAGING_PROJECT_REF
```

The default is read-only. Read every `CONFLICT` before applying: it means an existing SKU, family identity, OEM code or alias is in the way. The command skips that SKU and its references and material links, rather than repurposing it; other eligible items can still be applied. An existing family is reused only by exact family code and slug, and is not rewritten if it or any of its variants is protected. `KEEP` explains why other rows are unchanged, including older stock and published demo SKUs, staff-touched records and anything absent from the repository. Expect the 35 desired SKUs to be considered, not necessarily 35 new drafts: existing identities and conflicts can reduce the number imported. Resolve those separately with a catalogue owner; do not change SKU or code ownership just to make the sync pass.

`ADD` lists missing eligible families, draft variants, unverified OEM references, private aliases, candidate compatibility and material rows; `UPDATE` lists the changed fields of unchanged-since-sync drafts or families. Old drafts without a sync record are kept even if blank or zero-stock: there is no way to prove no one edited them. If a later migration changes the shape of tracked rows, the sync also keeps those rows rather than assuming differences are safe. The command won't publish, delete, adjust stock, overwrite existing shared lookup definitions, or edit existing orders, costs, accounts or requests. Its own private record and the database's existing price audit can record newly imported draft prices; published prices stay unchanged. The definition is taken from explicit data blocks in `supabase/seed.sql`; the seed's writes aren't run. After apply, go to **Staff desk → Catalogue** to see the new drafts.

Apply recalculates the plan under short-lived database locks and commits once; it does not replay an old dry run. Run it when staff and order activity are quiet. If it can't lock the tables, it stops without making changes. If the connection drops, run the dry run again to check what was committed before trying again. On local Supabase, use `pnpm db:env` and `pnpm catalogue:sync --local` (optionally `--apply`); pre-existing seed/fixture rows are protected just like pre-existing hosted rows.

### Load disposable sales dashboard orders

Use these orders only in local development or on isolated, protected staging. Every order has a `[DEMO]` business and recipient name, an `@edgey-orders-demo.invalid` email, and a **DO NOT SHIP** address. Don't change the orders, link real customer activity to them, or use them to test payments or fulfil real parcels. They intentionally count in staging reports.

```sh
# Local Supabase, after applying local migrations and with no demo batch loaded:
pnpm db:start && pnpm db:env && pnpm db:fixture
pnpm demo:orders --local
# View the staff Sales dashboard, then remove the batch:
pnpm demo:orders:clean --local

# Hosted staging: set the ref, direct or session pooler URL, and TLS CA as above.
pnpm demo:orders --staging --project-ref "$STAGING_PROJECT_REF"
pnpm demo:orders:clean --staging --project-ref "$STAGING_PROJECT_REF"
unset EDGEY_STAGING_DB_URL EDGEY_STAGING_DB_CA_FILE
```

The loader needs current order, credit and delivery migrations and the published staging catalogue with prices. The warehouse and carrier calendars must cover the current UK week, the previous nine weeks and upcoming delivery promises. It checks free stock before writing anything: Z10 13, Z16 6, Z50 1, SR6223 5, Z71 2, Z1 4, MIM-A45 4, SUM-DRG-36 3 and SUM-TAN-36 1. If the check fails, inspect active orders or receive authorised staging stock through the staff desk. The script does not create stock, change prices or costs, or publish variants. Avoid loading during active warehouse tests; the demo uses available stock until cleaned up.

The 15 orders cover all three price tiers, card and Net 30, dispatches, cancellations, full and partial refunds, and open, overdue and settled invoice balances. Every order ends dispatched or cancelled, so no demo order appears in the active picking queue or holds a reservation. The loader runs the database workflows directly with fictional provider IDs and dates orders across ten Europe/London calendar weeks. Stock ledger entries show when the fixture changed the actual stock balances, not the fictional dispatch dates. A historical demo sale still needs an earlier costed receipt or a variant estimate to show margin; the loader doesn't invent a landed cost for staging.

Stripe and the mail providers are not called. The loader removes confirmation and approval outbox rows before commit, creates no provider events or retries, and gives each demo order an infinite Stripe replay deadline so the current cron queries cannot select it. The Net 30 buyer has no credentials or sessions and is banned from sign-in. The temporary warehouse/finance actor is removed before commit. No additional database migration or worker deployment is needed.

Clean up as soon as you've captured the dashboard. Cleanup uses exact IDs and fingerprints from a private manifest created by the loader, locks the fixture and affected stock rows, and reverses only the demo's movement deltas in a single transaction. Subsequent real receipts, shipments, and reservations are kept, including their point-in-time movement snapshots. The command refuses if a fixture row changed, a related real row prevents safe deletion, stock counters disagree with the ledger, a demo SKU was physically count-corrected after loading, or demo identities exist without a manifest. Don't bypass those checks with a broad delete or stock reset; inspect the conflicting records with a database operator. A second cleanup is a no-op, and the empty private manifest table remains available for the next batch.

## 3. Set up Supabase Auth and the test staff

1. Under **Authentication → URL Configuration**, set **Site URL** to the staging origin and add only the exact callback `https://<staging-host>/auth/confirm` to the hosted redirect allowlist. Keep local redirects in the local stack. Enable the Email provider and email confirmation. Keep the Confirm signup and Magic link templates pointing to `{{ .ConfirmationURL }}`; the callback expects a PKCE `code`, not a `token_hash` query parameter. Open the email link in the browser that requested it.
2. In Resend, use **Auto Configure** with Vercel DNS to add the records for `mail.edgey.site`, then confirm the domain is verified. Add a TXT record at `_dmarc.mail.edgey.site` with `v=DMARC1; p=none;` (monitoring only). Do not add staging mail records to the apex. In **Authentication → Emails → SMTP Settings**, enable [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). For [Resend SMTP](https://resend.com/docs/send-with-supabase-smtp), use `smtp.resend.com`, port `465`, username `resend` and a staging Resend API key as the password. Set `orders@mail.edgey.site` as the sender and disable click tracking on the Auth links. Configure Supabase Auth rate limits for controlled testing. Auth SMTP is separate from the application's Resend HTTP API; do not put the SMTP password into Vercel.
3. After the fixture import, create each staff user under **Authentication → Users → Add user → Create new user**, confirm the controlled email and issue a unique strong password securely. Copy the created user's UUID. In that staging project's SQL Editor, add one role row per user, with only the access needed:

   ```sql
   insert into public.staff_members (user_id, role) values
     ('<warehouse Auth UUID>', 'warehouse'),
     ('<catalogue Auth UUID>', 'catalogue'),
     ('<finance Auth UUID>', 'finance');
   ```

   Enable TOTP enrollment and verification in hosted Supabase Auth. During in-person onboarding, confirm the staff member's identity independently. Observe them enroll their own authenticator at `/admin/sign-in` and verify the code. Copy the exact factor ID shown on their pending-approval screen in person; do not approve a factor based on an email, chat request, friendly name, or the newest record in Supabase. A trusted operator must activate that verified factor using the hosted SQL editor:

   ```sql
   select public.activate_staff_authenticator('<staff Auth UUID>', '<observed factor UUID>');
   ```

   The app and database match the actual GoTrue session's TOTP factor to that approval. A password, magic link, or a verified but unapproved TOTP factor cannot grant staff access. Before making staff access available, confirm this policy on the target Supabase version with a controlled staff account, then verify that each approved staff member reaches only their assigned roles. Migrate existing staff factors through the same check; there is no grandfathering. For lost authenticators, verify identity in person, revoke sessions and remove roles before resetting factors, then restore only the approved role and repeat enrollment and approval. Keep staff accounts separate from buyer accounts. Do not use the local-only `scripts/seed-admin.ts` on hosted staging.

   Confirm Auth password policy (including leaked-password protection where available), Auth throttles for password/token/OTP/MFA and SMTP send limits. Rate-limit the direct anonymous `search_blades` RPC at the Supabase API boundary. Vercel protection does not cover the Supabase API or Auth endpoints. Exercise the normal Finder, quote, checkout and staff paths after configuring limits. The app limits public selection quotes to 100 lines, 120 priced checks per trusted IP per hour and 10,000 globally. The public quote budget does not gate checkout; payment uses its own limits. Include checkout endpoints in hosted abuse monitoring because initial payment requests may reprice before the reservation limits. Confirm the hosted trusted IP header is present, comes only from the platform and stays correct behind any fronting proxy. Where the deployment permits it, add managed abuse controls for distributed requests, magic-link quota exhaustion and unsolicited receipt emails. Do not treat client-supplied IP or a honeypot as a substitute for hosted limits. The protected checklist did not sign off these controls.

## 4. Set up Stripe, email and the deployment environment

1. Stripe is not configured on hosted staging. For the payment acceptance pass, use an isolated Stripe sandbox with cards enabled and Apple Pay/Google Pay where eligible. Use that sandbox's `sk_test_…` key. Add a **snapshot** webhook in the same sandbox at `https://<staging-host>/api/webhooks/stripe`, API version **2026-11-18.endive**. Subscribe to:

   - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`
   - `invoice.finalized`, `invoice.sent`, `invoice.paid`, `invoice.payment_succeeded`, `invoice_payment.paid`
   - `invoice.voided`, `invoice.deleted`, `invoice.marked_uncollectible`, `invoice.overdue`, `credit_note.created`, `credit_note.voided`

   Save that endpoint's signing secret, not the secret from a local Stripe CLI listener. If Vercel protects the domain, [configure its automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation) on the Stripe endpoint URL with the `x-vercel-protection-bypass` query parameter so Stripe can reach it. Keep that endpoint URL with its token private and verify an actual signed delivery; it must not be redirected to a login. Keep the Stripe sandbox fixed while any orders are pending.
2. In the staging Vercel project's **Settings → Environment Variables**, configure the following for **Production**. Generate the hash key and Cron token independently with `openssl rand -hex 32` in a private terminal and store them securely. Enable Vercel's system environment variables so `VERCEL=1` is available and the app uses Vercel's trusted client IP; do not spoof the header or set `VERCEL` yourself.

   | Name | Value and source |
   | --- | --- |
   | `NEXT_PUBLIC_SITE_URL` | `https://staging.edgey.site` without a path; use the same origin for the Supabase Auth Site URL and callbacks. |
   | `NEXT_PUBLIC_SUPABASE_URL` | Staging Supabase's project API origin, `https://<project-ref>.supabase.co`, from **Connect** or the project's API settings. |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging Supabase's public publishable key (or legacy anon key); never the secret key. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server only: staging Supabase secret key or legacy service-role key. |
   | `EDGEY_REQUEST_HASH_KEY` | Server only: stable random key of at least 32 bytes for checkout, staff sign-in, request limits and Finder fingerprints. |
   | `STRIPE_SECRET_KEY` | Server only: full Stripe sandbox secret key (`sk_test_…`); do not use a live key. |
   | `STRIPE_WEBHOOK_SECRET` | Server only: signing secret (`whsec_…`) for the sandbox snapshot endpoint above. |
   | `NET30_CHECKOUT_ENABLED` | Keep `false` until the [Net 30 sandbox sign-off](net30-sandbox.md). Turn it on only in the isolated staging deployment for that test. |
   | `CRON_SECRET` | Server only: independently generated bearer token of at least 32 bytes that Vercel includes on worker requests. |
   | `EMAIL_PROVIDER` | `resend` (the default). The file outbox is local only. |
   | `RESEND_API_KEY` | Server only: API key with sending permission for the verified staging domain. |
   | `EMAIL_FROM` | Verified staging sender `orders@mail.edgey.site`, optionally with a display name. |
   | `REQUEST_STAFF_EMAIL` | One plain email address for the controlled staff requests inbox. |
   | `EDGEY_PRIVACY_NOTICE_URL` | Published HTTPS privacy notice for the hosted forms; include the appropriate test handling. |
   | `EDGEY_PUBLIC_REQUESTS_ENABLED` | Keep `false` during setup and for public access until the intake gates below are met. The current protected staging run uses `true` as a controlled-test exception, for approved testers using fictional details only. Enables enquiries, trial/trade intake and buyer magic links. |

   Mark server-only credentials and tokens as Sensitive in Vercel. Keep `SUPABASE_DB_URL`, `EDGEY_LOCAL_STAFF_PASSWORD`, `PLAYWRIGHT_PORT` and `EMAIL_OUTBOX_DIR` local. Keep `EDGEY_STAGING_DB_URL`, `EDGEY_STAGING_DB_CA_FILE`, `SUPABASE_ACCESS_TOKEN` and any `VERCEL_TOKEN` in operator tooling only. `NODE_ENV`, `VERCEL` and CI variables are supplied by their runtimes. Do not copy `.env.local` onto Vercel.
3. Verify the Git-linked Production deployment uses the committed `vercel.json`. In **Settings → Cron Jobs**, check that `/api/cron/stripe-reconciliation`, `/api/cron/order-confirmations` and `/api/cron/request-emails` are registered to run every minute. Vercel sends `Authorization: Bearer …` automatically when the secret is set. A bare request must not execute a worker. On this staging setup, native Cron reached the protected deployment: the two mail workers returned 200 and Stripe reconciliation returned the expected 503 with Stripe unset. The earlier Supabase fallback jobs were retired; do not run both schedulers or relax deployment protection to get Cron working.
4. Have operations publish the business contact and privacy information and approve explicit positive retention intervals for enquiries, trials, trade applications and Finder events. In the staging Supabase Cron dashboard (enable `pg_cron` if needed), schedule a daily SQL job calling `public.purge_request_data` as a privileged database operator. Replace every placeholder below with an approved PostgreSQL interval before scheduling at an agreed UTC time:

   ```sql
   select public.purge_request_data(
     interval '<enquiry age>', interval '<trial age>',
     interval '<trade application age>', interval '<Finder event age>'
   );
   ```

   Verify a run in the job history and configure failure monitoring. This job preserves approved trial/trade and converted enquiries and does not manage order PII or Auth users. Before opening intake to the public or starting live sales, the owner must approve separate deletion or minimisation rules for those records, covering statutory invoice retention, active orders and credit, dispute/legal holds, unconfirmed Auth users, and the copies held by email/payment providers and backups. Specify what is removed or retained and when, who may run it, and how the result is audited. The protected test is not evidence that the purge job is scheduled or the privacy notice is adequate. Do not lift protection or accept real details until the approved privacy, retention and abuse safeguards are in place. A setting change does not update an already-built deployment.

   Blade enquiry photos follow the parent enquiry’s retention, including the existing exception for matched enquiries. Applying `20261123204600_enquiry_photos.sql` creates the private `enquiry-photos` bucket; don’t create it separately or add client access policies. Confirm the existing `CRON_SECRET` is configured and deploy the merged app. In Vercel **Settings → Cron Jobs**, verify `/api/cron/enquiry-photos` runs daily at 03:30 UTC; monitor failures alongside the request purge. It removes up to 200 orphaned objects per run through the Storage API, waiting until each object is at least an hour old to keep it away from an in-flight upload. The existing request purge still needs an owner-approved enquiry age. On protected staging, submit a fictional compatibility enquiry with a generated test JPEG, open it as catalogue or warehouse staff, then verify an unauthenticated visitor and finance-only staff cannot open the same app photo URL. Signed Storage URLs stay on the server.

   Keep the Supabase service-role key in server-only configuration, use separate keys and projects per environment, and rotate it on suspected exposure. It bypasses RLS: the staff application verifies the session and derives actor identity before invoking staff service RPCs, and each RPC rechecks the applicable database role. A holder of the master key is not equally constrained. Review Auth logs and the existing per-domain operation/ledger history; confirm production alerting and decide retention for any cross-domain actor audit before adding one.

## 5. Check the selected environment

Run `pnpm staging:check` with only the staging app's variables exported, or pass the exact dotenv snapshot with `pnpm staging:check --from <file>`. For a Vercel snapshot, verify the CLI is linked to the staging project first:

```sh
(
  umask 077
  directory=$(mktemp -d)
  trap 'rm -rf "$directory"' EXIT
  vercel env pull "$directory/staging.env" --environment=production &&
    pnpm staging:check --from "$directory/staging.env"
)
```

Do not commit, upload or log the snapshot. If Vercel withholds sensitive values, validate using the same values from the operator's secret store in a private shell instead; the checker must treat withheld values as missing. It reports missing or invalid settings without printing their values and exits nonzero if staging isn't configured for the full checklist. It does not call providers, inspect a running function, prove that the projects are isolated or verify that the values reached the active deployment. Confirm those in the dashboards and run the checks below against the deployed commit.

## 6. Run the weekend staging checklist on the deployed site

Record the deployed commit, staging URL, time, test order reference and evidence with personal details and secrets removed. Do not ship a parcel or use a real order address. The table records the 21 November hosted run; the boxes below are for repeating the full checklist.

| Evidence to record | Result |
| --- | --- |
| Deployment URL, commit and time (UTC) | [Protected staging](https://staging.edgey.site), `main` at [`cf83172`](https://github.com/hey-winkin/edgey/commit/cf83172faae1e66c2e265fa5a785fd2bb50b5be2), live from 2026-11-21 15:49:56 UTC. |
| Catalogue, Finder and selection | **Passed.** Catalogue and EDG-Z10 page; exact `3910301`, required choice for `SPB-0030`, and no match for an unknown code or `5201345`. Five EDG-Z10s totalled £128.04 with VAT and delivery. Without Stripe the checkout stayed in place and showed a polite refusal; no order or order reservation was created. |
| Order reference, invoice and pick-list checks | **Not run.** No Stripe sandbox payment, signed webhook, paid return, order reference, invoice, paid-order confirmation, pick list or paid-order dispatch. |
| Last-blade contender and restored availability | **Not run.** Stripe checkout contention, expiry and release remain untested on hosted staging. |
| Trial, Auth, mail and supported wallets | **Partial.** Trial intake through fictional dispatch passed; two units were reserved and consumed once, and no parcel was sent. Enquiry intake passed after a settled-page retry; staff reply was not run. Role denial and sign-in throttling passed, with a quick-retry defect. The buyer magic-link request succeeded, but the real emailed callback was not run. Six app notices were accepted by Resend; inbox delivery is unconfirmed. Wallets were not run. |
| Finder latency | **50 ms RPC target unproven.** 100 warm RPCs measured p95 154 ms from a runner probably in the US (routing hints only) against Stockholm. Remeasure near the database. The separate 390 px browser check measured p95 1,373 ms over 20 samples, including debounce; it had no pass threshold. |
| Visual evidence and any exceptions | The main buyer routes passed checks with exceptions in both themes at 1440, 390 and 320 px, including keyboard and reduced motion. Populated quote captures used a browser-only fixture; the £128.04 checkout was checked separately without it. The authenticated staff desktop checks and one dark 390 px desk capture do not complete the staff mobile or staff keyboard matrix. See [release status](release-status.md#hosted-staging-evidence-21-november-2026) for open defects. The hosted checklist and redacted captures are retained internally (`renders/EDGE-18/hosted-checklist/`). |

- [ ] **Find the exact blade.** Use “Find a blade” and search packet code `3910301`. It must select EDG-Z10, the flat-stock drag blade for the UCT. Search `SPB-0030` and confirm the 45° and 60° options require a choice. An unfamiliar code should offer an enquiry, and `5201345` must never match Z71.
- [ ] **Order it and receive confirmation.** In a clean guest session, take five EDG-Z10s through selection and checkout with a controlled mailbox and a supported fictional UK business address. Expect £99.75 goods, £6.95 delivery and £21.34 VAT, for **£128.04** in Edgey and Stripe. Use Stripe test card `4242 4242 4242 4242`, a future expiry and any three-digit CVC. Confirm the Stripe webhook got a 2xx response and the Edgey return page shows the paid order. Wait for the workers, check exactly one Edgey confirmation with the right SKU/quantity and dispatch promise, and check £128.04 on the Stripe paid invoice. Refresh the saved success page and confirm the order, allocation and email do not duplicate. Separately verify eligible Apple Pay and Google Pay on supported devices and record what was available.
- [ ] **Pick that exact variant and record dispatch.** At `/admin/warehouse`, open that order and its printable pick list. Match EDG-Z10, quantity five, the recorded recipient, service and promised dispatch date against checkout and confirmation. Start picking, record a fictional carrier and tracking reference, and confirm it appears as dispatched once in history with the same reference. Do not send any physical goods.
- [ ] **Prove two buyers cannot buy the last blade.** Verify one EDG-MIM-A60 is available in staff stock. In two independent guest browser contexts with distinct controlled emails, submit payment for one 60° unit at the same time. Exactly one may see a payable Stripe session; the other must see an availability correction, not a second payable session. Do not pay for this contention check. With the Stripe CLI authenticated to the same sandbox, run `stripe checkout sessions expire <cs_test_session_id>` using the winning session ID from that sandbox. Verify Stripe reports it expired and reconciliation releases the hold. Close the losing test session after its buyer proves they can now reach payment. Expiry of the old session must not create an order confirmation.
- [ ] **Request a trial without a delivery promise.** Submit `/sample-pack` with a controlled work email, company, machine brand, OEM code or “unknown”, and a test postcode. Check receipt on screen and by email, no promise of dispatch, no stock reservation on intake, and a matching staff request. Confirm a test buyer can open a real Auth magic link in the originating browser and a buyer without a staff role cannot use the staff desk.
- [ ] **Review and fulfil the test trial.** As catalogue staff, check the fit and eligibility, then choose two specific blade units. As warehouse staff, verify the fictional delivery address and service, approve the trial and check that exactly two units are reserved. Record a test dispatch and tracking reference; the allocation should be consumed once. Separately exercise staff trial notifications and an enquiry reply with controlled inboxes. A message queued in the staff desk is not proof of delivery.

Measure Finder latency separately from the journey: point `pnpm bench:search` at the isolated staging Supabase public endpoint for 100 warm RPCs (p95 under 50 ms). On a controlled browser runner with Chromium installed and access to the storefront, run `node scripts/bench-finder-mobile.mjs <storefront-origin>` for the 390 px browser input-to-exact-result latency, including the debounce. The benchmark requires the staging fixture for `3910301` and identifies its browser as a benchmark so it does not add search events. For a protected deployment, use an authorised browser/device and record the same interval; do not pass protection credentials in the URL. Record environment, sample count and network/device conditions with the result.

Keep automated acceptance results separate from this hosted evidence. Review [the design acceptance pass](../design.md#visual-acceptance-pass) on the deployed build; it calls for both themes at 1440, 390 and 320 px, keyboard/focus and reduced-motion checks, and screenshots of deliberate departures.

If a Stripe event stalls, check the sandbox delivery and Finance queue before replaying. Never free a hold when Stripe creation or capture is ambiguous. If email delivery is uncertain, look up the order reference in Resend before any manual send. Do not force a resend by resetting an outbox row. A sandbox invoice is not evidence of statutory VAT compliance.

The staff trial detail shows notice states. For error details, check `message_key`, `state` and `last_error` in `public.order_outbox` for the request's `trial_request_id` in the staging Supabase SQL Editor. An unsent approval withdrawn on cancellation is intentionally suppressed.

## 7. Run the Net 30 sandbox sign-off

Finance should follow the [Net 30 checklist](net30-sandbox.md) in the isolated staging deployment. Check the request worker's `trade_approved` and `trade_rejected` delivery against a controlled mailbox; approval is not proof that mail was sent. Trade decision delivery state is available in the same outbox by `trade_application_id`. Reset the flag after the exercise if terms are not approved for ongoing use.
