import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { drainFinanceRetries, requestFinanceReplay } from "@/lib/admin/replay";
import { processOrderConfirmations, processRequestEmails, replayOrderConfirmation } from "@/lib/email/outbox";
import { requestReceipt } from "@/lib/email/request-email";
import { createLocalAdminUser } from "../../scripts/seed-admin";

const { retrieveInvoice } = vi.hoisted(() => ({ retrieveInvoice: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/stripe", () => ({ getStripe: () => ({ invoices: { retrieve: retrieveInvoice } }) }));

type Row = {
  id: string;
  message_key: string;
  order_id: string | null;
  state: "pending" | "failed" | "sent";
  attempt_count: number;
  lease_token: string | null;
  send_started_at: Date | null;
  send_payload: string | null;
  send_provider: string | null;
  send_in_flight: boolean;
  last_error: string | null;
  next_attempt_at: Date;
  delivery_uncertain: boolean;
  provider_message_id: string | null;
  sent_at: Date | null;
};

let connectionString: string;
let db: Client;
let unrelatedQueue: Client | undefined;
const fixtures: string[] = [];
const requests: { table: "enquiries" | "trial_requests"; id: string }[] = [];
const recipientFingerprints: string[] = [];
const requestActors: string[] = [];
const trialProducts: { variantId: string; productId: string }[] = [];

async function connect() {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3_000, statement_timeout: 5_000 });
  await client.connect();
  return client;
}

beforeAll(async () => {
  const local = process.env.SUPABASE_DB_URL;
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!local || !api || ![local, api].every((url) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname))) {
    throw new Error("These tests need local Supabase. Run pnpm db:start && pnpm db:env.");
  }
  connectionString = local;
  db = await connect();
});

beforeEach(async () => {
  unrelatedQueue = await connect();
  await unrelatedQueue.query("begin");
  await unrelatedQueue.query("select id from public.order_outbox where state = 'pending' for update");
  await unrelatedQueue.query("select target_id from public.finance_retry_requests where kind = 'confirmation' for update");
});

afterEach(async () => {
  await unrelatedQueue?.end();
  unrelatedQueue = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  retrieveInvoice.mockReset();
  const ids = fixtures.splice(0);
  if (ids.length) {
    await db.query("delete from public.order_outbox where order_id = any($1)", [ids]);
    await db.query("delete from public.order_items where order_id = any($1)", [ids]);
    await db.query("delete from public.orders where id = any($1)", [ids]);
  }
  for (const { table, id } of requests.splice(0)) {
    if (table === "trial_requests") {
      await db.query("begin");
      try {
        await db.query("delete from public.stock_movements where trial_request_id = $1", [id]);
        await db.query("delete from public.trial_allocations where trial_request_id = $1", [id]);
        await db.query("delete from public.trial_fulfilments where trial_request_id = $1", [id]);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback");
        throw error;
      }
    }
    await db.query(`delete from public.${table} where id = $1`, [id]);
  }
  for (const { variantId, productId } of trialProducts.splice(0)) {
    await db.query("delete from public.stock_movements where variant_id = $1", [variantId]);
    await db.query("delete from public.variants where id = $1", [variantId]);
    await db.query("delete from public.products where id = $1", [productId]);
  }
  for (const actorId of requestActors.splice(0)) {
    await db.query("delete from auth.users where id = $1", [actorId]);
  }
  const fingerprints = recipientFingerprints.splice(0);
  if (fingerprints.length) {
    await db.query("delete from private.payment_rate_limits where scope = 'request_receipt' and key = any($1)", [fingerprints]);
  }
});

afterAll(() => db?.end());

async function fixture(state: "failed" | "pending" = "pending", invoiceId: string | null = null) {
  const id = randomUUID();
  fixtures.push(id);
  await db.query(`
    insert into public.orders (
      id, checkout_attempt_token, email, recipient_name, business_name, buying_for_work,
      address_line1, address_town, address_postcode, address_country, goods_net_pence,
      delivery_net_pence, vat_rate_bps, vat_pence, gross_pence, paid_pence, payment_status,
      fulfilment_status, authorised_at, hold_expires_at, delivery_service, promised_dispatch_date,
      estimated_delivery_date, provider_invoice_id
    ) values (
      $1, $2, 'test@example.test', 'A Test Buyer', 'Delivery Test', true, '1 Test Street',
      'London', 'SW1A 1AA', 'GB', 1000, 100, 2000, 220, 1320, 1320, 'paid', 'ready_to_pick',
      now(), now() + interval '32 minutes', 'Standard', '2026-11-23', '2026-11-24', $3
    )
  `, [id, randomUUID(), invoiceId]);
  await db.query(`
    insert into public.order_items (
      order_id, variant_id, sku, option_label, quantity, unit_price_pence, net_pence, tax_pence, gross_pence
    ) select $1, id, 'ORIGINAL-SKU', 'Original option', 1, 1000, 1000, 200, 1200
      from public.variants limit 1
  `, [id]);
  await db.query("select public.enqueue_order_confirmation($1)", [id]);
  await db.query("update public.order_outbox set state = $2, next_attempt_at = '1970-01-01' where order_id = $1", [id, state]);
  return id;
}

const claim = (client: Client, orderId?: string, queue = "order_confirmation") =>
  client.query<Row>("select * from public.claim_outbox_email($1, $2)", [queue, orderId ?? null]).then(({ rows }) => rows);

const begin = (row: Row, payload?: string, fingerprint?: string, client = db) => client.query<Row>(
  "select * from public.begin_outbox_email_send($1, $2, $3, $4, $5)",
  [row.id, row.lease_token, payload === undefined ? null : "resend", payload ?? null, fingerprint ?? null],
).then(({ rows }) => rows);

const finish = (row: Row, outcome: string, providerId?: string) => db.query<Row>(
  "select * from public.finish_outbox_email($1, $2, $3, $4)",
  [row.id, row.lease_token, outcome, providerId ?? null],
).then(({ rows }) => rows);

const readOutbox = (id: string) => db.query<Row>(
  "select * from public.order_outbox where order_id = $1", [id],
).then(({ rows }) => rows[0]!);

const initialPayload = '{"sender":"original", "order": "unchanged"}';

test.each(["pending", "failed"] as const)("two independent service workers cannot claim the same %s row", async (state) => {
  const id = await fixture(state);
  const workers = await Promise.all([connect(), connect()]);
  try {
    await Promise.all(workers.map((worker) => worker.query("begin; set local role service_role")));
    const results = await Promise.all(workers.map((worker) => claim(worker, state === "failed" ? id : undefined)));
    const winners = results.flat().filter((row) => row.order_id === id);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.lease_token).toEqual(expect.any(String));
  } finally {
    await Promise.all(workers.map(async (worker) => {
      await worker.query("rollback");
      await worker.end();
    }));
  }
});

test("reclaims an expired lease with the same payload and fences the original worker", async () => {
  const id = await fixture();
  const [first] = (await claim(db)).filter((row) => row.order_id === id);
  expect(first).toBeDefined();
  const [attempt] = await begin(first!, initialPayload);
  expect(attempt).toMatchObject({ send_payload: initialPayload, send_in_flight: true, attempt_count: 1 });
  expect(await begin(first!)).toEqual([]);
  await db.query(`
    update public.order_outbox set lease_until = now() - interval '1 second',
      next_attempt_at = '1970-01-01' where order_id = $1
  `, [id]);
  const [second] = (await claim(db)).filter((row) => row.order_id === id);
  expect(second).toMatchObject({ send_payload: initialPayload, delivery_uncertain: true, send_in_flight: false });
  expect(second!.lease_token).not.toBe(first!.lease_token);
  expect(await finish(first!, "sent", "late")).toEqual([]);
  await expect(begin(second!, '{"different":true}')).rejects.toMatchObject({ message: "outbox_email_payload_frozen" });
  const [retry] = await begin(second!);
  expect(retry).toMatchObject({ send_payload: initialPayload, attempt_count: 2, send_started_at: attempt!.send_started_at });
  expect((await finish(second!, "sent", "same-provider-message"))[0]).toMatchObject({
    state: "sent", delivery_uncertain: false, last_error: null, sent_at: expect.any(Date),
    provider_message_id: "same-provider-message", lease_token: null,
  });
  expect(await claim(db, id)).toEqual([]);
  await db.query("select public.enqueue_order_confirmation($1)", [id]);
  expect(await readOutbox(id)).toMatchObject({ state: "sent", attempt_count: 2 });
});

test("backs off ambiguous outcomes and refuses automatic or manual retry at the deduplication cutoff", async () => {
  const id = await fixture();
  const [first] = (await claim(db)).filter((row) => row.order_id === id);
  expect(first).toBeDefined();
  await begin(first!, initialPayload);
  const [after] = await finish(first!, "provider_uncertain");
  expect(after).toMatchObject({ state: "pending", last_error: "provider_uncertain", delivery_uncertain: true });
  expect(after!.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 55_000);
  expect(await claim(db, id)).toEqual([]);
  await db.query(`
    update public.order_outbox set send_started_at = now() - interval '23 hours 56 minutes',
      next_attempt_at = '1970-01-01' where order_id = $1
  `, [id]);
  const ended = (await claim(db)).find((row) => row.order_id === id);
  expect(ended).toMatchObject({
    state: "failed", last_error: "delivery_unconfirmed", delivery_uncertain: true, lease_token: null, attempt_count: 1,
  });
  expect(await replayOrderConfirmation(id)).toBe("not_replayable");
});

test("invalidates a claimed retry that reaches the cutoff before begin-send", async () => {
  const id = await fixture("failed");
  const [first] = await claim(db, id);
  await begin(first!, initialPayload);
  await finish(first!, "provider_rejected");
  const [second] = await claim(db, id);
  await db.query("update public.order_outbox set send_started_at = now() - interval '24 hours' where order_id = $1", [id]);
  expect(await begin(second!)).toEqual([]);
  await db.query(`
    update public.order_outbox set lease_until = now() - interval '1 second',
      next_attempt_at = '1970-01-01' where order_id = $1
  `, [id]);
  expect((await claim(db)).find((row) => row.order_id === id)).toMatchObject({
    state: "failed", last_error: "retry_window_expired", delivery_uncertain: false, attempt_count: 1,
  });
});

test("stops on an idempotency conflict and preserves the ambiguity of a previous attempt", async () => {
  const id = await fixture("failed");
  await db.query("update public.order_outbox set delivery_uncertain = true where order_id = $1", [id]);
  const [initial] = await claim(db, id);
  await begin(initial!, initialPayload);
  expect((await finish(initial!, "provider_rejected"))[0]).toMatchObject({
    state: "failed", delivery_uncertain: true,
  });
  const [retry] = await claim(db, id);
  await begin(retry!);
  expect((await finish(retry!, "provider_conflict"))[0]).toMatchObject({
    state: "failed", last_error: "delivery_unconfirmed", delivery_uncertain: true,
  });
  expect(await claim(db, id)).toEqual([]);
});

test("keeps delivery RPCs and sensitive outbox data service-only", async () => {
  const { rows } = await db.query<{
    role: string; claim: boolean; begin: boolean; finish: boolean; payload: boolean; subject: boolean; body: boolean; metadata: boolean;
  }>(`
    select role,
      has_function_privilege(role, 'public.claim_outbox_email(text,uuid,timestamptz)', 'execute') as claim,
      has_function_privilege(role, 'public.begin_outbox_email_send(uuid,uuid,text,text,text)', 'execute') as begin,
      has_function_privilege(role, 'public.finish_outbox_email(uuid,uuid,text,text)', 'execute') as finish,
      has_column_privilege(role, 'public.order_outbox', 'send_payload', 'select') as payload,
      has_column_privilege(role, 'public.order_outbox', 'message_subject', 'select') as subject,
      has_column_privilege(role, 'public.order_outbox', 'message_body', 'select') as body,
      has_column_privilege(role, 'public.order_outbox', 'last_error', 'select') as metadata
    from unnest(array['anon', 'authenticated', 'service_role']) as role
  `);
  expect(rows).toEqual([
    { role: "anon", claim: false, begin: false, finish: false, payload: false, subject: false, body: false, metadata: false },
    { role: "authenticated", claim: false, begin: false, finish: false, payload: false, subject: false, body: false, metadata: true },
    { role: "service_role", claim: true, begin: true, finish: true, payload: true, subject: true, body: true, metadata: true },
  ]);
});

test("only the operator can configure carrier templates and invalid pattern shapes are rejected", async () => {
  const { rows } = await db.query(`
    select role,
      has_table_privilege(role, 'public.delivery_tracking_patterns', 'select') as read,
      has_table_privilege(role, 'public.delivery_tracking_patterns', 'insert') as write,
      has_column_privilege(role, 'public.order_outbox', 'dispatch_lines', 'select') as snapshot
    from unnest(array['anon', 'authenticated', 'service_role']) as role
  `);
  expect(rows).toEqual([
    { role: "anon", read: false, write: false, snapshot: false },
    { role: "authenticated", read: false, write: false, snapshot: false },
    { role: "service_role", read: true, write: false, snapshot: true },
  ]);
  for (const pattern of [
    "http://carrier.example.test/{tracking}", "https://carrier.example.test/track", "https://carrier.example.test/{tracking}/{tracking}",
  ]) {
    await expect(db.query("insert into public.delivery_tracking_patterns values ('Fixture Invalid Carrier', $1)", [pattern]))
      .rejects.toMatchObject({ code: "23514" });
  }
});

test("gives a recently authorised order time to pick up its invoice without freezing a body", async () => {
  const id = await fixture("failed");
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("EMAIL_FROM", "orders@example.test");
  vi.stubEnv("RESEND_API_KEY", "test-mocked-resend-key");
  const provider = vi.fn();
  const request = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "https://api.resend.com/emails" ? provider(input, init) : request(input, init),
  );

  expect(await replayOrderConfirmation(id)).toBe("pending");
  const row = await readOutbox(id);
  expect(row).toMatchObject({ state: "pending", attempt_count: 0, send_started_at: null, send_payload: null });
  expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 55_000);
  expect(retrieveInvoice).not.toHaveBeenCalled();
  expect(provider).not.toHaveBeenCalled();
});

test("freezes the first Stripe invoice and Resend body across actual PostgREST calls and staff replay", async () => {
  const id = await fixture("failed", `in_${randomUUID()}`);
  const { rows: [order] } = await db.query<{ order_reference: string }>(
    "select order_reference from public.orders where id = $1", [id],
  );
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("EMAIL_FROM", "orders@example.test");
  vi.stubEnv("RESEND_API_KEY", "test-mocked-resend-key");
  retrieveInvoice.mockResolvedValue({ hosted_invoice_url: "https://invoice.stripe.com/i/test-1" });
  const provider = vi.fn()
    .mockImplementationOnce(() => Response.json({ name: "validation_error" }, { status: 422 }))
    .mockImplementationOnce(() => Response.json({ id: "resend-message-id" }));
  const request = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "https://api.resend.com/emails" ? provider(input, init) : request(input, init),
  );

  expect(await replayOrderConfirmation(id)).toBe("failed");
  const first = await readOutbox(id);
  expect(first).toMatchObject({ state: "failed", attempt_count: 1, send_provider: "resend", last_error: "provider_rejected" });
  expect(first.send_payload).toContain(order!.order_reference);
  expect(first.send_payload).not.toContain(id);
  expect(JSON.parse(first.send_payload!).text).toContain("https://invoice.stripe.com/i/test-1");
  expect(JSON.parse(first.send_payload!).from).toBe("orders@example.test");
  vi.stubEnv("EMAIL_FROM", "changed@example.test");
  retrieveInvoice.mockResolvedValue({ hosted_invoice_url: "https://invoice.stripe.com/i/changed" });
  await db.query("update public.order_items set option_label = 'Changed option' where order_id = $1", [id]);
  expect(await replayOrderConfirmation(id)).toBe("sent");
  expect(await replayOrderConfirmation(id)).toBe("not_replayable");
  expect(retrieveInvoice).toHaveBeenCalledTimes(1);
  expect(provider).toHaveBeenCalledTimes(2);
  for (const [, init] of provider.mock.calls) {
    expect(init.headers["Idempotency-Key"]).toBe(`outbox-email/${first.id}`);
    expect(init.body).toBe(first.send_payload);
  }
  expect(await readOutbox(id)).toMatchObject({
    state: "sent", attempt_count: 2, provider_message_id: "resend-message-id", send_payload: first.send_payload,
  });
});

test("dispatch bypasses the invoice wait and retries a lost provider response with the same bytes and key", async () => {
  const id = await fixture("failed", `in_${randomUUID()}`);
  const carrier = `Fixture ${randomUUID()}`;
  await db.query("insert into public.delivery_tracking_patterns (carrier, url_pattern) values ($1, $2)",
    [carrier, "https://carrier.example.test/track/{tracking}"]);
  try {
    await db.query("update public.orders set fulfilment_status = 'picking' where id = $1", [id]);
    await db.query(`update public.orders set fulfilment_status = 'dispatched', dispatched_at = now(),
      carrier = $2, tracking_number = 'TRACK/01' where id = $1`, [id, carrier]);
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("EMAIL_FROM", "orders@example.test");
    vi.stubEnv("RESEND_API_KEY", "test-mocked-resend-key");
    const provider = mockResend().mockRejectedValueOnce(new Error("Response lost"));
    const readDispatch = async () => (await db.query<Row>(
      "select * from public.order_outbox where order_id = $1 and message_key = 'order_dispatched'", [id],
    )).rows[0]!;

    expect(await processOrderConfirmations()).toEqual({ sent: 0, failed: 0, pending: 1 });
    const first = await readDispatch();
    expect(first).toMatchObject({ state: "pending", delivery_uncertain: true, attempt_count: 1 });
    expect(JSON.parse(first.send_payload!).text).toContain("https://carrier.example.test/track/TRACK%2F01");
    await db.query("update public.delivery_tracking_patterns set url_pattern = $2 where carrier = $1",
      [carrier, "https://other.example.test/{tracking}"]);
    await db.query("update public.order_outbox set next_attempt_at = now() where id = $1", [first.id]);
    const outcomes = await Promise.all([processOrderConfirmations(), processOrderConfirmations()]);
    expect(outcomes.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(await readDispatch()).toMatchObject({ state: "sent", attempt_count: 2, send_payload: first.send_payload });
    expect(retrieveInvoice).not.toHaveBeenCalled();
    expect(provider.mock.calls).toHaveLength(2);
    for (const [init] of provider.mock.calls) {
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(`outbox-email/${first.id}`);
      expect(init?.body).toBe(first.send_payload);
    }
    await db.query(`update public.order_outbox set state = 'failed', sent_at = null, provider_message_id = null
      where order_id = $1 and message_key = 'order_dispatched'`, [id]);
    await db.query("update public.order_outbox set state = 'sent' where order_id = $1 and message_key = 'order_confirmation'", [id]);
    expect(await replayOrderConfirmation(id)).toBe("not_replayable");
    expect((await readDispatch()).state).toBe("failed");
  } finally {
    await db.query("delete from public.delivery_tracking_patterns where carrier = $1", [carrier]);
  }
});

test("keeps previously queued trial dispatch copy without retroactive address expansion", async () => {
  const email = `${randomUUID()}@example.test`;
  configureRequests(email);
  const trial = await requestFixture("trial_requests", email);
  await markIntakeSent(trial);
  await db.query(`insert into public.order_outbox (trial_request_id, message_key, message_subject, message_body)
    values ($1, 'trial_dispatched', 'Legacy dispatch', 'Tracking number: LEGACY')`, [trial.id]);
  const provider = mockResend();
  expect(await processRequestEmails()).toEqual({ sent: 1, failed: 0, pending: 0 });
  expect(JSON.parse(String(provider.mock.calls[0]?.[0]?.body))).toEqual({
    from: "orders@example.test", to: [email], subject: "Legacy dispatch", text: "Tracking number: LEGACY",
  });
});

async function requestFixture(table: "enquiries" | "trial_requests", email: string) {
  const id = randomUUID();
  requests.push({ table, id });
  const fields = table === "enquiries" ? "enquiry_id" : "trial_request_id";
  if (table === "enquiries") {
    await db.query("select public.submit_enquiry($1, 'compatibility', $2, 'Private enquiry text')", [id, email]);
  } else {
    await db.query("select public.submit_trial_request($1, 'Private brand', 'Private OEM code', $2, 'Private company', 'SW1A 1AA')",
      [id, email]);
  }
  const { rows } = await db.query<Row>(`
    update public.order_outbox set next_attempt_at = '1970-01-01' where ${fields} = $1 returning *
  `, [id]);
  return { id, receipt: rows.find(row => row.message_key === "confirmation")!, staff: rows.find(row => row.message_key === "staff_notification")! };
}

function configureRequests(email: string) {
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("EMAIL_FROM", "orders@example.test");
  vi.stubEnv("RESEND_API_KEY", "test-mocked-resend-key");
  vi.stubEnv("REQUEST_STAFF_EMAIL", "staff@example.test");
  vi.stubEnv("EDGEY_REQUEST_HASH_KEY", "test-only-request-key-with-thirty-two-bytes");
  const receipt = requestReceipt("orders@example.test", email)!;
  recipientFingerprints.push(receipt.recipientFingerprint);
  return receipt;
}

function mockResend() {
  const provider = vi.fn<(init?: RequestInit) => Response>(() => Response.json({ id: `resend-${randomUUID()}` }));
  const request = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === "https://api.resend.com/emails" ? provider(init) : request(input, init),
  );
  return provider;
}

async function requestActor(role: "catalogue" | "warehouse") {
  const { id } = await createLocalAdminUser(role);
  requestActors.push(id);
  return id;
}

const privateReason = "Private trial eligibility reason";

async function reviewTrial(id: string, actor: string, variants: string[] | null) {
  await db.query(`
    select public.review_admin_trial(id, $2, $3, $4, $5, updated_at)
    from public.trial_requests where id = $1
  `, [id, actor, variants ? "eligible" : "declined", privateReason, variants]);
}

async function approveTrial(id: string, catalogue: string, warehouse: string) {
  const variantId = randomUUID();
  const sku = `mail-trial-${variantId}`;
  const { rows } = await db.query<{ id: string }>(`
    insert into public.products (family_code, slug, name, tool_category)
    values ($1, $1, 'Mail trial fixture', 'oscillating') returning id
  `, [sku]);
  const productId = rows[0]!.id;
  trialProducts.push({ variantId, productId });
  await db.query(`
    insert into public.variants (id, product_id, sku, supplier_part_number, evidence_source, approved_at,
      publication_status, price_1_4_pence, price_5_9_pence, price_10_plus_pence)
    values ($1, $2, $3, $3, 'Mail trial fixture', now(), 'published', 1000, 900, 800)
  `, [variantId, productId, sku]);
  await db.query("select public.receive_stock($1, $2, 2, $3)", [variantId, sku, warehouse]);
  const variants = [variantId, variantId];
  await reviewTrial(id, catalogue, variants);
  await db.query("select public.approve_trial_fulfilment($1, $2, $3, $4, 'Test Carrier', 'Standard', true)", [
    id, warehouse, variants, {
      recipient_name: "Private recipient", line1: "1 Private Street", town: "London", postcode: "SW1A 1AA", country: "GB",
    },
  ]);
}

async function replyToEnquiry(id: string, actor: string, reply: string) {
  await db.query(`
    select public.handle_admin_enquiry(id, $2, 'reply', updated_at, $3, $4)
    from public.enquiries where id = $1
  `, [id, actor, randomUUID(), reply]);
}

async function markIntakeSent({ receipt, staff }: Awaited<ReturnType<typeof requestFixture>>) {
  await db.query("update public.order_outbox set state = 'sent' where id = any($1)", [[receipt.id, staff.id]]);
}

test("permits one freeze when independent workers race receipts from different sources to one recipient", async () => {
  const email = `${randomUUID()}@example.test`;
  const { payload, recipientFingerprint } = configureRequests(email);
  const first = await requestFixture("enquiries", email);
  const second = await requestFixture("trial_requests", email.toUpperCase());
  const workers = await Promise.all([connect(), connect()]);
  let winner: Row;
  try {
    await Promise.all(workers.map(worker => worker.query("set role service_role")));
    const claims = await Promise.all(workers.map(async worker => (await claim(worker, undefined, "confirmation"))[0]!));
    expect(claims.map(row => row.id).sort()).toEqual([first.receipt.id, second.receipt.id].sort());
    const results = await Promise.all(claims.map(async (row, i) => (await begin(row, payload, recipientFingerprint, workers[i]))[0]!));
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "pending", send_in_flight: true, send_payload: payload, attempt_count: 1 }),
      expect.objectContaining({ state: "failed", last_error: "recipient_throttled", send_payload: null, attempt_count: 0 }),
    ]));
    winner = results.find(row => row.send_in_flight)!;
  } finally {
    await Promise.all(workers.map(worker => worker.end()));
  }

  await finish(winner, "provider_uncertain");
  await db.query("update public.order_outbox set next_attempt_at = '1970-01-01' where id = $1", [winner.id]);
  const [retry] = await claim(db, undefined, "confirmation");
  expect(retry?.id).toBe(winner.id);
  expect((await begin(retry!))[0]).toMatchObject({ send_payload: payload, attempt_count: 2 });
  const limit = await db.query("select attempts from private.payment_rate_limits where scope = 'request_receipt' and key = $1",
    [recipientFingerprint]);
  expect(limit.rows).toEqual([{ attempts: 1 }]);
});

test("drains neutral request mail without touching order mail or exposing submitted text", async () => {
  const email = `${randomUUID()}@example.test`;
  configureRequests(email);
  const order = await fixture();
  const first = await requestFixture("enquiries", email);
  const second = await requestFixture("trial_requests", email.toUpperCase());
  const ids = [first.receipt.id, first.staff.id, second.receipt.id, second.staff.id];
  const provider = mockResend();

  expect(await processRequestEmails()).toEqual({ sent: 3, failed: 1, pending: 0 });
  expect(provider).toHaveBeenCalledTimes(3);
  expect(await readOutbox(order)).toMatchObject({ state: "pending", attempt_count: 0 });
  expect(await replayOrderConfirmation(first.id)).toBe("not_replayable");
  const { rows } = await db.query<Row>("select * from public.order_outbox where id = any($1)", [ids]);
  for (const row of rows) {
    if (row.last_error === "recipient_throttled") {
      expect(row.send_payload).toBeNull();
      continue;
    }
    expect(row.state).toBe("sent");
    expect(row.send_payload).not.toMatch(/Private|SW1A/i);
    const message = JSON.parse(row.send_payload!);
    if (row.message_key === "confirmation") {
      expect(message.to[0].toLowerCase()).toBe(email);
      expect(message.subject).toBe("Edgey received a request");
      expect(message.text).not.toContain(email);
      expect(message.text).not.toContain(first.id);
      expect(message.text).not.toContain(second.id);
    } else {
      expect(message.to).toEqual(["staff@example.test"]);
      expect(message.text).toBe(row.id === first.staff.id ? `Type: Enquiry\nReference: ${first.id}`
        : `Type: Sample request\nReference: ${second.id}`);
      expect(row.send_payload).not.toContain(email);
    }
  }
});

test("does not send a frozen staff notice after the explicit destination changes", async () => {
  const email = `${randomUUID()}@example.test`;
  configureRequests(email);
  const source = await requestFixture("enquiries", email);
  await db.query("update public.order_outbox set state = 'sent' where id = $1", [source.receipt.id]);
  const [staff] = await claim(db, undefined, "staff_notification");
  expect(staff?.id).toBe(source.staff.id);
  await begin(staff!, JSON.stringify({ to: ["staff@example.test"] }));
  await finish(staff!, "provider_uncertain");
  await db.query("update public.order_outbox set next_attempt_at = '1970-01-01' where id = $1", [staff!.id]);
  vi.stubEnv("REQUEST_STAFF_EMAIL", "new-staff@example.test");
  const provider = mockResend();
  expect(await processRequestEmails()).toEqual({ sent: 0, failed: 1, pending: 0 });
  expect(provider).not.toHaveBeenCalled();
  const row = (await db.query<Row>("select * from public.order_outbox where id = $1", [staff!.id])).rows[0];
  expect(row).toMatchObject({
    state: "failed", attempt_count: 1, delivery_uncertain: true, last_error: "configuration_error",
  });
});

test("delivers staff-authored text and the trial shipment without bypassing intake receipt limits", async () => {
  const email = `${randomUUID()}@example.test`;
  configureRequests(email);
  const catalogue = await requestActor("catalogue");
  const warehouse = await requestActor("warehouse");
  const enquiry = await requestFixture("enquiries", email);
  const dispatched = await requestFixture("trial_requests", email);
  const declined = await requestFixture("trial_requests", email);
  const reply = 'Try <b>this & that</b>\n\n<script>alert("test")</script>';
  const tracking = "TRACK-<17>&";
  await replyToEnquiry(enquiry.id, catalogue, reply);
  await db.query(`
    select public.handle_admin_enquiry(id, $2, 'close', updated_at)
    from public.enquiries where id = $1
  `, [enquiry.id, catalogue]);
  await approveTrial(dispatched.id, catalogue, warehouse);
  await db.query("select public.dispatch_trial_fulfilment($1, $2, $3)", [dispatched.id, warehouse, tracking]);
  await reviewTrial(declined.id, catalogue, null);
  const provider = mockResend();

  expect(await processOrderConfirmations()).toEqual({ sent: 0, failed: 0, pending: 0 });
  expect(provider).not.toHaveBeenCalled();
  const firstBatch = await processRequestEmails();
  const secondBatch = await processRequestEmails();
  expect(firstBatch.sent + secondBatch.sent).toBe(8);
  expect(firstBatch.failed + secondBatch.failed).toBe(2);
  expect(await processRequestEmails()).toEqual({ sent: 0, failed: 0, pending: 0 });
  expect(provider).toHaveBeenCalledTimes(8);

  const { rows } = await db.query<Row & { message_subject: string; message_body: string }>(`
    select * from public.order_outbox
    where (enquiry_id = $1 or trial_request_id in ($2, $3))
      and message_key not in ('confirmation', 'staff_notification')
  `, [enquiry.id, dispatched.id, declined.id]);
  expect(rows.map(row => row.message_key)).toEqual(expect.arrayContaining([
    expect.stringMatching(/^enquiry_reply:/), "trial_approved", "trial_dispatched", "trial_declined",
  ]));
  expect(rows).toHaveLength(4);
  expect(rows.find(row => row.message_key.startsWith("enquiry_reply:"))?.message_body).toBe(reply);
  expect(rows.find(row => row.message_key === "trial_dispatched")?.message_body).toContain(tracking);
  for (const row of rows) {
    expect(row).toMatchObject({ state: "sent", attempt_count: 1, provider_message_id: expect.any(String) });
    expect(provider).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": `outbox-email/${row.id}` }),
      body: row.send_payload,
    }));
    const payload = JSON.parse(row.send_payload!);
    if (row.message_key === "trial_dispatched") {
      expect(payload).toEqual({
        from: "orders@example.test", to: [email], subject: `Edgey trial pack dispatched: ${dispatched.id}`,
        text: expect.stringContaining(`Carrier: Test Carrier\nTracking number: ${tracking}\n\nDelivery address:\nPrivate recipient\n1 Private Street`),
        html: expect.stringContaining("TRACK-&lt;17&gt;&amp;"),
      });
    } else {
      expect(payload).toEqual({
        from: "orders@example.test", to: [email], subject: row.message_subject, text: row.message_body,
      });
      expect(row.send_payload).not.toMatch(/Private Street|Private recipient/);
    }
    expect(row.send_payload).not.toMatch(new RegExp(`${privateReason}|Private enquiry text`));
  }
});

test("retries a staff reply with the same provider key and frozen text across overlapping workers", async () => {
  const email = `${randomUUID()}@example.test`;
  configureRequests(email);
  const enquiry = await requestFixture("enquiries", email);
  await markIntakeSent(enquiry);
  await replyToEnquiry(enquiry.id, await requestActor("warehouse"), "A staff response");
  const provider = mockResend().mockReturnValueOnce(Response.json({}, { status: 503 }));

  expect(await processRequestEmails()).toEqual({ sent: 0, failed: 0, pending: 1 });
  expect(await processRequestEmails()).toEqual({ sent: 0, failed: 0, pending: 0 });
  expect(provider).toHaveBeenCalledOnce();
  const { rows } = await db.query<Row>(`
    update public.order_outbox set next_attempt_at = '1970-01-01'
    where enquiry_id = $1 and message_key like 'enquiry_reply:%' returning *
  `, [enquiry.id]);
  const reply = rows[0]!;
  expect(reply).toMatchObject({ state: "pending", delivery_uncertain: true, attempt_count: 1 });
  vi.stubEnv("EMAIL_FROM", "changed@example.test");
  const results = await Promise.all([processRequestEmails(), processRequestEmails()]);
  expect(results.map(result => result.sent).sort()).toEqual([0, 1]);
  expect(provider).toHaveBeenCalledTimes(2);
  expect(provider.mock.calls[1]?.[0]?.headers).toEqual(provider.mock.calls[0]?.[0]?.headers);
  expect(provider.mock.calls[1]?.[0]?.body).toBe(reply.send_payload);
  const { rows: [sent] } = await db.query<Row>("select * from public.order_outbox where id = $1", [reply.id]);
  expect(sent).toMatchObject({ state: "sent", delivery_uncertain: false, attempt_count: 2 });
});

test.each([false, true])("suppresses a cancelled approval at begin-send (previous attempt: %s)", async (retried) => {
  const email = `${randomUUID()}@example.test`;
  configureRequests(email);
  const trial = await requestFixture("trial_requests", email);
  const warehouse = await requestActor("warehouse");
  await markIntakeSent(trial);
  await approveTrial(trial.id, await requestActor("catalogue"), warehouse);
  const provider = mockResend();
  if (retried) {
    provider.mockReturnValueOnce(Response.json({}, { status: 503 }));
    expect(await processRequestEmails()).toEqual({ sent: 0, failed: 0, pending: 1 });
    await db.query(`update public.order_outbox set next_attempt_at = '1970-01-01'
      where trial_request_id = $1 and message_key = 'trial_approved'`, [trial.id]);
    provider.mockClear();
  }
  const request = globalThis.fetch;
  const cancel = (client: Client) => client.query("select public.cancel_trial_fulfilment($1, $2)", [trial.id, warehouse]);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/rpc/begin_outbox_email_send")) return request(input, init);
    if (retried) {
      await cancel(db);
      return request(input, init);
    }
    const cancellation = await connect();
    try {
      await cancellation.query("begin");
      const { rows } = await cancellation.query<{ pid: number }>("select pg_backend_pid() as pid");
      await cancel(cancellation);
      const response = request(input, init);
      try {
        await expect.poll(async () => {
          const { rows: [lock] } = await db.query<{ blocked: boolean }>(`
            select exists (
              select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
            ) as blocked
          `, [rows[0]!.pid]);
          return lock?.blocked;
        }).toBe(true);
      } finally {
        await cancellation.query("commit");
        await response;
      }
      return response;
    } finally {
      await cancellation.end();
    }
  });

  expect(await processRequestEmails()).toEqual({ sent: 0, failed: 1, pending: 0 });
  expect(provider).not.toHaveBeenCalled();
  const { rows: [approval] } = await db.query<Row>(`
    select * from public.order_outbox where trial_request_id = $1 and message_key = 'trial_approved'
  `, [trial.id]);
  expect(approval).toMatchObject({
    state: "failed", last_error: "trial_approval_withdrawn", lease_token: null, send_in_flight: false,
    sent_at: null, send_payload: retried ? expect.any(String) : null,
    attempt_count: retried ? 1 : 0, delivery_uncertain: retried,
  });
  expect(await processRequestEmails()).toEqual({ sent: 0, failed: 0, pending: 0 });
});

test("scheduled finance replay claims a failed confirmation once and records its real outcome", async () => {
  const order = await fixture("failed");
  await db.query("update public.order_outbox set created_at = now() - interval '3 minutes' where order_id = $1", [order]);
  configureRequests("replay@example.test");
  const provider = mockResend();
  const finance = await createLocalAdminUser("finance");
  try {
    expect(await requestFinanceReplay(finance.id, { kind: "confirmation", id: order })).toBe(true);
    const results = await Promise.all([
      drainFinanceRetries("confirmation", replayOrderConfirmation),
      drainFinanceRetries("confirmation", replayOrderConfirmation),
    ]);
    expect(results.map((row) => row.claimed).sort()).toEqual([0, 1]);
    expect(provider).toHaveBeenCalledOnce();
    expect(await readOutbox(order)).toMatchObject({ state: "sent", attempt_count: 1 });
    const resolved = await db.query("select result from public.finance_retry_requests where kind = 'confirmation' and target_id = $1", [order]);
    expect(resolved.rows).toEqual([{ result: "sent" }]);
  } finally {
    await db.query("delete from public.finance_retry_requests where target_id = $1", [order]);
    await db.query("delete from auth.users where id = $1", [finance.id]);
  }
});
