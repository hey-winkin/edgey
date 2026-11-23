import { randomUUID } from "node:crypto";
import { setDbClaims } from "../helpers/db-claims";
import { Client, type QueryResultRow } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

let connectionString: string;
let db: Client;

async function connect() {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3000, statement_timeout: 8000 });
  await client.connect();
  return client;
}

beforeAll(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("These tests need the local Supabase stack. Run pnpm db:start && pnpm db:env.");
  }
  connectionString = url;
  db = await connect();
});

afterAll(() => db?.end());

async function one<R extends QueryResultRow>(sql: string, args: unknown[] = [], client = db) {
  const { rows } = await client.query<R>(sql, args);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

const rpc = async <T = string>(name: string, args: unknown[], client = db) =>
  (await one<{ result: T }>(
    `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as result`, args, client,
  )).result;

async function rejects(query: () => Promise<unknown>, code: string, message?: string) {
  await db.query("savepoint trial_error");
  try {
    await expect(query()).rejects.toMatchObject(message ? { code, message } : { code });
  } finally {
    await db.query("rollback to savepoint trial_error");
    await db.query("release savepoint trial_error");
  }
}

async function actor(role?: "warehouse" | "catalogue" | "finance") {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
    [id, `${id}@example.test`]);
  if (role) await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [id, role]);
  return id;
}

async function variant(warehouse: string, available: number, published = true) {
  const id = randomUUID();
  const sku = `admin-trial-${id}`;
  const { id: family } = await one<{ id: string }>(`
    insert into public.products (family_code, slug, name, tool_category)
    values ($1, $1, 'Admin trial test family', 'oscillating') returning id
  `, [sku]);
  await db.query(`
    insert into public.variants (id, product_id, sku, supplier_part_number, evidence_source, approved_at,
      publication_status, price_1_4_pence, price_5_9_pence, price_10_plus_pence)
    values ($1, $2, $3, $3, 'Admin trial test fixture', now(), $4, 1000, 900, 800)
  `, [id, family, sku, published ? "published" : "draft"]);
  if (available) await rpc("receive_stock", [id, sku, available, warehouse]);
  return { id, family };
}

const postcode = "SW1A 1AA";
const address = { recipient_name: "Test Buyer", line1: "1 Test Street", town: "London", postcode, country: "GB" };
const reason = "Internal fit and eligibility check";
const submit = (id = randomUUID(), email = `${id}@example.test`) =>
  rpc("submit_trial_request", [id, "zund", "unknown", email, "Test Fabrication", postcode]);
const trialVersion = async (id: string) => (await one<{ updated_at: string }>(
  "select updated_at::text from public.trial_requests where id = $1", [id],
)).updated_at;
const review = async (id: string, catalogue: string, units: (string | null)[] | null, decision = "eligible", note = reason, version?: string) =>
  rpc("review_admin_trial", [id, catalogue, decision, note, units, version ?? await trialVersion(id)]);
const approvalArgs = (id: string, warehouse: string, units: string[], delivery: Record<string, unknown> = address,
  verified = true) =>
  [id, warehouse, units, delivery, "Test Carrier", "Standard", verified];
const approve = (id: string, warehouse: string, units: string[], client = db) =>
  rpc("approve_trial_fulfilment", approvalArgs(id, warehouse, units), client);
const dispatch = (id: string, warehouse: string, tracking = "TRACK-123") =>
  rpc("dispatch_trial_fulfilment", [id, warehouse, tracking]);
const link = (trial: string, order: string, warehouse: string, client = db) =>
  rpc("link_trial_order", [trial, order, warehouse], client);
const unlink = (trial: string, order: string, warehouse: string) =>
  rpc("unlink_trial_order", [trial, order, warehouse]);
const metric = (warehouse: string) => rpc<number>("count_admin_trial_first_purchases", [warehouse]);
const stock = (id: string) =>
  one("select stock_on_hand, stock_reserved from public.variants where id = $1", [id]);
const order = (variantId: string, token: string, email = `${token}@example.test`, buyerId?: string, client = db) =>
  one<{ id: string }>(`
    select id from public.create_order_with_reservations(
      $1, $2, $3, $4, $5, clock_timestamp() + interval '30 minutes', 'Standard',
      current_date + 1, current_date + 2, $6
    )
  `, [
    token, JSON.stringify([{ variant_id: variantId, quantity: 1, unit_price_pence: 1000 }]),
    JSON.stringify({ email, business_name: "Test Fabrication", recipient_name: "Test Buyer", buying_for_work: true }),
    JSON.stringify({ line1: address.line1, town: address.town, postcode, country: "GB" }),
    JSON.stringify({ goods_net_pence: 1000, delivery_net_pence: 0, vat_rate_bps: 2000, vat_pence: 200, gross_pence: 1200 }),
    buyerId ?? null,
  ], client);

async function pay(id: string) {
  const intent = randomUUID();
  await db.query(`
    select id from public.confirm_payment($1, $2, $3, 1200, 'GBP', clock_timestamp(), current_date + 1, current_date + 2, null)
  `, [id, randomUUID(), intent]);
  return intent;
}

const outbox = async (id: string) => (await db.query(`
  select id, message_key, message_subject, message_body, state from public.order_outbox
  where trial_request_id = $1 and message_key like 'trial_%' order by message_key
`, [id])).rows;

async function dispatchedTrial(warehouse: string, catalogue: string, variantId: string) {
  const id = await submit();
  await review(id, catalogue, [variantId, variantId]);
  await approve(id, warehouse, [variantId, variantId]);
  await dispatch(id, warehouse);
  return id;
}

describe("staff trial workflow", () => {
  beforeEach(() => db.query("begin"));
  afterEach(() => db.query("rollback"));

  test("requires the service role and gates review separately from every warehouse action", async () => {
    const warehouse = await actor("warehouse");
    const catalogue = await actor("catalogue");
    const finance = await actor("finance");
    const id = await submit();
    const sku = randomUUID();
    const version = await trialVersion(id);
    const call = [() => review(id, catalogue, [sku, sku], "eligible", reason, version), () => approve(id, warehouse, [sku, sku]),
      () => dispatch(id, warehouse), () => rpc("cancel_trial_fulfilment", [id, warehouse]),
      () => link(id, randomUUID(), warehouse), () => unlink(id, randomUUID(), warehouse), () => metric(warehouse)];
    for (const role of ["anon", "authenticated"]) {
      await setDbClaims(db, role, catalogue, role === "authenticated");
      await db.query(`set local role ${role}`);
      for (const action of call) await rejects(action, "42501");
      await rejects(() => db.query("update public.trial_requests set status = 'in_review' where id = $1", [id]), "42501");
      await db.query("reset role");
    }

    await db.query("set local role service_role");
    for (const person of [warehouse, finance]) {
      await rejects(() => review(id, person, [sku, sku]), "42501", "catalogue_role_required");
    }
    for (const person of [catalogue, finance]) {
      for (const action of [() => approve(id, person, [sku, sku]), () => dispatch(id, person),
        () => rpc("cancel_trial_fulfilment", [id, person]), () => link(id, randomUUID(), person),
        () => unlink(id, randomUUID(), person), () => metric(person)]) {
        await rejects(action, "42501", "warehouse_role_required");
      }
    }
    await rejects(() => db.query("select private.allocate_reviewed_trial($1,$2,$3,$4,$5,$6,$7)",
      approvalArgs(id, warehouse, [sku, sku])), "42501");
    await rejects(() => db.query("update public.trial_requests set eligibility = 'eligible' where id = $1", [id]), "42501");
  });

  test("duplicate evidence finds independent earlier matches and respects trial request RLS", async () => {
    const catalogue = await actor("catalogue");
    const finance = await actor("finance");
    const buyer = await actor();
    const request = (id: string, email: string, company: string, postcode: string) =>
      rpc("submit_trial_request", [id, "zund", "unknown", email, company, postcode]);
    const email = "fixture@example.test";
    const target = randomUUID();
    const older = [randomUUID(), randomUUID(), randomUUID()];
    await request(older[0]!, email.toUpperCase(), "Different", "EC1A 1BB");
    await request(older[1]!, "company@example.test", "  Print Room  ", "EC1A 1BB");
    await request(older[2]!, "postcode@example.test", "Another", postcode);
    await db.query("update public.trial_requests set created_at = now() - interval '1 minute' where id = any($1)", [older]);
    await request(target, email, "print room", postcode);
    const newer = await request(randomUUID(), email, "print room", postcode);
    await db.query("update public.trial_requests set created_at = now() + interval '1 minute' where id = $1", [newer]);
    for (const id of [catalogue, finance, buyer]) {
      await setDbClaims(db, "authenticated", id, id !== buyer);
      await db.query("set local role authenticated");
      const { rows } = await db.query("select id, same_email, same_company, same_postcode from public.admin_trial_duplicate_evidence($1)", [target]);
      await db.query("reset role");
      expect(rows).toEqual(id === catalogue ? [
        { id: older[0], same_email: true, same_company: false, same_postcode: false },
        { id: older[1], same_email: false, same_company: true, same_postcode: false },
        { id: older[2], same_email: false, same_company: false, same_postcode: true },
      ] : []);
    }
  });

  test("allows catalogue to revise an eligible review and records a terminal decline with private notes", async () => {
    const warehouse = await actor("warehouse");
    const catalogue = await actor("catalogue");
    const first = await variant(warehouse, 0);
    const second = await variant(warehouse, 0);
    const draft = await variant(warehouse, 0, false);
    const id = await submit();
    await db.query("set local role service_role");
    await rejects(() => approve(id, warehouse, [first.id, first.id]), "22023", "eligible_trial_review_required");
    for (const invalid of [null, [first.id], [first.id, null], [first.id, first.id, first.id]]) {
      await rejects(() => review(id, catalogue, invalid), "22023", "two_trial_units_required");
    }
    await rejects(() => review(id, catalogue, [first.id, draft.id]), "22023", "variant_not_published");
    await rejects(() => review(id, catalogue, [first.id], "declined"), "22023", "declined_trial_has_variants");
    const originalVersion = await trialVersion(id);
    expect(await review(id, catalogue, [first.id, first.id])).toBe(id);
    await rejects(() => review(id, catalogue, [first.id, second.id], "eligible", reason, originalVersion), "22023", "trial_stale");
    expect(await review(id, catalogue, [first.id, second.id])).toBe(id);
    expect(await one("select status, eligibility, reviewed_variant_ids, reviewed_at, reviewed_by, staff_notes from public.trial_requests where id = $1", [id]))
      .toEqual({ status: "in_review", eligibility: "eligible", reviewed_variant_ids: [first.id, second.id].sort(),
        reviewed_at: expect.any(Date), reviewed_by: catalogue, staff_notes: reason });
    await rejects(() => approve(id, warehouse, [first.id, first.id]), "22023", "trial_units_do_not_match_review");
    expect(await outbox(id)).toEqual([]);
    expect(await review(id, catalogue, [], "declined")).toBe(id);
    expect(await review(id, catalogue, null, "declined")).toBe(id);
    await rejects(() => review(id, catalogue, [first.id, second.id]), "22023", "trial_not_reviewable");
    await rejects(() => approve(id, warehouse, [first.id, second.id]), "22023", "eligible_trial_review_required");
    expect(await one("select status, eligibility, reviewed_variant_ids from public.trial_requests where id = $1", [id]))
      .toEqual({ status: "declined", eligibility: "declined", reviewed_variant_ids: [] });
    expect(await outbox(id)).toEqual([{
      id: expect.any(String), message_key: "trial_declined", message_subject: "Your Edgey trial request",
      message_body: expect.not.stringContaining(reason), state: "pending",
    }]);
  });

  test("validates the reviewed units and complete address, and sends approval and dispatch copy only once", async () => {
    const warehouse = await actor("warehouse");
    const catalogue = await actor("catalogue");
    const first = (await variant(warehouse, 2)).id;
    const second = (await variant(warehouse, 1)).id;
    const id = await submit();
    await db.query("set local role service_role");
    await review(id, catalogue, [first, second]);
    await rejects(() => approve(id, warehouse, [first]), "22023", "two_trial_units_required");
    await rejects(() => rpc("approve_trial_fulfilment", approvalArgs(id, warehouse, [first, second], address, false)),
      "22023", "verified_delivery_address_and_service_required");
    for (const delivery of [{ ...address, line1: "\t\n" }, { ...address, country: "FR" }, { ...address, postcode: "bad" }]) {
      await rejects(() => rpc("approve_trial_fulfilment", approvalArgs(id, warehouse, [first, second], delivery)), "23514");
    }
    await rejects(() => rpc("approve_trial_fulfilment", approvalArgs(id, warehouse, [first, second],
      { ...address, town: null })), "22023", "verified_delivery_address_and_service_required");
    expect(await outbox(id)).toEqual([]);
    expect(await approve(id, warehouse, [second, first])).toBe(id);
    expect(await approve(id, warehouse, [first, second])).toBe(id);
    await rejects(() => review(id, catalogue, [], "declined"), "22023", "trial_not_reviewable");
    expect(await stock(first)).toEqual({ stock_on_hand: 2, stock_reserved: 1 });
    expect(await stock(second)).toEqual({ stock_on_hand: 1, stock_reserved: 1 });

    await rejects(() => dispatch(id, warehouse, "\t"), "22023", "trial_tracking_required");
    expect((await outbox(id)).map(({ message_key }) => message_key)).toEqual(["trial_approved"]);
    await db.query("update public.order_outbox set state = 'sent' where trial_request_id = $1 and message_key = 'trial_approved'", [id]);
    expect(await dispatch(id, warehouse)).toBe(id);
    const messages = await outbox(id);
    expect(await approve(id, warehouse, [first, second])).toBe(id);
    expect(await dispatch(id, warehouse)).toBe(id);
    expect(await outbox(id)).toEqual(messages);
    expect(messages).toEqual([
      { id: expect.any(String), message_key: "trial_approved", state: "sent", message_subject: expect.any(String),
        message_body: expect.not.stringContaining(reason) },
      { id: expect.any(String), message_key: "trial_dispatched", state: "pending", message_subject: expect.any(String),
        message_body: expect.stringContaining("TRACK-123") },
    ]);
    expect(await stock(first)).toEqual({ stock_on_hand: 1, stock_reserved: 0 });
    expect(await stock(second)).toEqual({ stock_on_hand: 0, stock_reserved: 0 });
    expect((await db.query("select kind from public.stock_movements where trial_request_id = $1 order by id", [id])).rows)
      .toEqual([{ kind: "reserve" }, { kind: "reserve" }, { kind: "dispatch" }, { kind: "dispatch" }]);
  });

  test("rejects cross-source outbox keys and rolls approval back if enqueue fails", async () => {
    const warehouse = await actor("warehouse");
    const catalogue = await actor("catalogue");
    const item = (await variant(warehouse, 2)).id;
    const id = await submit();
    const enquiry = await rpc("submit_enquiry", [randomUUID(), "compatibility", "trial@example.test", "Test enquiry"]);
    for (const [source, sourceId, key] of [
      ["trial_request_id", id, `enquiry_reply:${randomUUID()}`],
      ["enquiry_id", enquiry, "trial_approved"],
      ["enquiry_id", enquiry, "enquiry_reply:not-a-uuid"],
    ]) {
      await rejects(() => db.query(`
        insert into public.order_outbox (${source}, message_key, message_subject, message_body) values ($1, $2, 'Subject', 'Body')
      `, [sourceId, key]), "23514");
    }
    await rejects(() => db.query(
      "insert into public.order_outbox (trial_request_id, message_key) values ($1, 'trial_approved')", [id]), "23514");
    await review(id, catalogue, [item, item]);
    await db.query(`
      insert into public.order_outbox (trial_request_id, message_key, message_subject, message_body)
      values ($1, 'trial_approved', 'Subject', 'Body')
    `, [id]);
    await db.query("set local role service_role");
    await rejects(() => approve(id, warehouse, [item, item]), "23505");
    expect(await stock(item)).toEqual({ stock_on_hand: 2, stock_reserved: 0 });
    expect((await db.query("select state from public.trial_fulfilments where trial_request_id = $1", [id])).rowCount).toBe(0);
    expect(await one("select status from public.trial_requests where id = $1", [id])).toEqual({ status: "in_review" });
  });

  test("accepts historical approval and dispatch replays without sending new notices", async () => {
    const warehouse = await actor("warehouse");
    const item = (await variant(warehouse, 2)).id;
    const id = await submit();
    await db.query("select private.allocate_reviewed_trial($1,$2,$3,$4,$5,$6,$7)", approvalArgs(id, warehouse, [item, item]));
    await db.query("select private.finish_trial_fulfilment($1,$2,'dispatch','TRACK-123')", [id, warehouse]);
    await db.query("set local role service_role");
    expect(await approve(id, warehouse, [item, item])).toBe(id);
    expect(await dispatch(id, warehouse)).toBe(id);
    expect(await outbox(id)).toEqual([]);
    expect(await stock(item)).toEqual({ stock_on_hand: 0, stock_reserved: 0 });
  });

  test("follows the seven-day London dispatch rule, reschedules, and clears the queue on conversion", async () => {
    const warehouse = await actor("warehouse");
    const catalogue = await actor("catalogue");
    const item = (await variant(warehouse, 10)).id;
    const trial = await dispatchedTrial(warehouse, catalogue, item);
    const { today, tomorrow, yesterday, farFuture } = await one<{
      today: string; tomorrow: string; yesterday: string; farFuture: string;
    }>(`
      select today::text, (today + 1)::text tomorrow, (today - 1)::text yesterday, (today + 366)::text "farFuture"
      from (select (now() at time zone 'Europe/London')::date today) dates
    `);
    const age = (days: number) => db.query(`
      update public.trial_fulfilments set dispatched_at =
        ((now() at time zone 'Europe/London')::date - $2::integer + time '23:45') at time zone 'Europe/London'
      where trial_request_id = $1
    `, [trial, days]);
    await setDbClaims(db, "authenticated", catalogue, true);
    const asStaff = async () => { await db.query("set local role authenticated"); };
    const due = () => db.query(
      "select due_on::text, days_waiting from public.admin_trial_follow_up_status() where trial_request_id = $1", [trial],
    ).then(({ rows }) => rows);
    const record = (date: string, outcome: string, next: string | null, expected: string | null) =>
      rpc("record_trial_follow_up", [trial, date, outcome, "  Called the print room.  ", next, expected]);

    await age(6);
    await asStaff();
    expect(await due()).toEqual([]);
    await db.query("reset role");
    await age(7);
    await asStaff();
    expect(await due()).toEqual([{ due_on: today, days_waiting: 7 }]);
    await rejects(() => record(today, "follow_up_again", null, null), "22023", "invalid_trial_follow_up_next_date");
    await rejects(() => record(today, "follow_up_again", today, null), "22023", "invalid_trial_follow_up_next_date");
    await rejects(() => record(today, "follow_up_again", farFuture, null), "22023", "trial_follow_up_next_date_too_far");
    await rejects(() => record(tomorrow, "no_reply", null, null), "22023", "invalid_trial_follow_up_date");
    const first = await record(yesterday, "follow_up_again", today, null);
    expect(await due()).toHaveLength(1);
    await rejects(() => record(today, "follow_up_again", tomorrow, null), "22023", "trial_follow_up_stale");
    const future = await record(today, "follow_up_again", tomorrow, first);
    expect(await due()).toEqual([]);
    expect(await one("select note, recorded_by, next_on::text from public.trial_follow_ups where id = $1", [first]))
      .toEqual({ note: "Called the print room.", recorded_by: catalogue, next_on: today });
    const current = await record(yesterday, "follow_up_again", today, future);
    expect(await due()).toEqual([{ due_on: today, days_waiting: 7 }]);
    await db.query("reset role");
    const purchase = await order(item, randomUUID());
    await pay(purchase.id);
    await asStaff();
    expect(await due()).toHaveLength(1);
    await db.query("reset role");
    await link(trial, purchase.id, warehouse);
    await asStaff();
    expect(await due()).toEqual([]);
    expect(await one("select converted, due_on from public.admin_trial_follow_up_status($1)", [trial]))
      .toEqual({ converted: true, due_on: null });
    await rejects(() => record(today, "ordered", null, current), "22023", "trial_follow_up_unavailable");
    await db.query("reset role");
    await unlink(trial, purchase.id, warehouse);
    await asStaff();
    expect(await due()).toHaveLength(1);
    await record(today, "not_a_fit", null, current);
    expect(await due()).toEqual([]);
  });

  test("only stepped-up warehouse and catalogue staff can read or record trial follow-ups", async () => {
    const warehouse = await actor("warehouse");
    const catalogue = await actor("catalogue");
    const finance = await actor("finance");
    const buyer = await actor();
    const trial = await dispatchedTrial(warehouse, catalogue, (await variant(warehouse, 2)).id);
    const status = () => db.query("select trial_request_id from public.admin_trial_follow_up_status($1)", [trial]);
    const record = (outcome: string, expected: string | null) => one<{ id: string }>(`
      select public.record_trial_follow_up($1, (now() at time zone 'Europe/London')::date, $2, null, null, $3) id
    `, [trial, outcome, expected]);
    let latest: string | null = null;
    for (const id of [warehouse, catalogue]) {
      await setDbClaims(db, "authenticated", id, true);
      await db.query("set local role authenticated");
      expect((await status()).rows).toEqual([{ trial_request_id: trial }]);
      latest = (await record(id === warehouse ? "no_reply" : "ordered", latest)).id;
      expect(await one("select recorded_by from public.trial_follow_ups where id = $1", [latest]))
        .toEqual({ recorded_by: id });
      await rejects(() => db.query("delete from public.trial_follow_ups where id = $1", [latest]), "42501");
      await db.query("reset role");
    }
    for (const [id, mfa] of [[warehouse, false], [finance, true], [buyer, false]] as const) {
      await setDbClaims(db, "authenticated", id, mfa);
      await db.query("set local role authenticated");
      expect((await db.query("select id from public.trial_follow_ups where trial_request_id = $1", [trial])).rows).toEqual([]);
      await rejects(status, "42501", "requests_role_required");
      await rejects(() => record("no_reply", latest), "42501", "requests_role_required");
      await db.query("reset role");
    }
    await setDbClaims(db, "anon");
    await db.query("set local role anon");
    await rejects(status, "42501");
    await rejects(() => record("no_reply", latest), "42501");
    await rejects(() => db.query("select id from public.trial_follow_ups"), "42501");
  });

  test("links only after explicit selection and counts qualifying first purchases by buyer ID or guest email", async () => {
    const warehouse = await actor("warehouse");
    const catalogue = await actor("catalogue");
    const buyer = await actor();
    const otherBuyer = await actor();
    const item = (await variant(warehouse, 20)).id;
    const base = await metric(warehouse);
    const trialId = await dispatchedTrial(warehouse, catalogue, item);
    const guestTrial = await dispatchedTrial(warehouse, catalogue, item);
    const early = await order(item, randomUUID(), "old-address@example.test", buyer);
    const earlyIntent = await pay(early.id);
    await rejects(() => link(trialId, early.id, warehouse), "22023", "not_a_subsequent_purchase");
    const orderEmail = "different-address@example.test";
    const unrelated = await order(item, randomUUID(), orderEmail, otherBuyer);
    await pay(unrelated.id);
    const purchase = await order(item, randomUUID(), orderEmail, buyer);
    const guestPrior = await order(item, randomUUID(), "GUEST@example.test");
    await pay(guestPrior.id);
    const guest = await order(item, randomUUID(), "guest@example.test");
    const cancelled = await order(item, randomUUID());
    await pay(cancelled.id);
    await rpc("cancel_order", [cancelled.id, randomUUID(), warehouse]);
    await db.query("update public.orders set created_at = clock_timestamp() where id = any($1::uuid[])", [
      [purchase.id, guest.id, cancelled.id],
    ]);
    await db.query("set local role service_role");
    await rejects(() => link(trialId, purchase.id, warehouse), "22023", "not_a_subsequent_purchase");
    await rejects(() => link(trialId, cancelled.id, warehouse), "22023", "not_a_subsequent_purchase");
    const purchaseIntent = await pay(purchase.id);
    await pay(guest.id);
    expect(await metric(warehouse)).toBe(base);
    expect(await link(trialId, purchase.id, warehouse)).toBe(trialId);
    await rejects(() => unlink(trialId, guest.id, warehouse), "22023", "trial_order_link_changed");
    await rejects(() => link(guestTrial, purchase.id, warehouse), "23505", "trial_order_already_linked");
    expect(await link(guestTrial, guest.id, warehouse)).toBe(guestTrial);
    expect(await metric(warehouse)).toBe(base);
    await rpc("record_refund", [early.id, randomUUID(), earlyIntent, 1200, "GBP"]);
    expect(await metric(warehouse)).toBe(base + 1);
    expect(await unlink(trialId, purchase.id, warehouse)).toBe(trialId);
    expect(await unlink(trialId, purchase.id, warehouse)).toBe(trialId);
    expect(await metric(warehouse)).toBe(base);
    expect(await link(trialId, purchase.id, warehouse)).toBe(trialId);
    await db.query("reset role");
    expect((await db.query("select action, actor_id from private.trial_order_attributions where trial_request_id = $1 order by id",
      [trialId])).rows).toEqual(["linked", "unlinked", "linked"].map((action) => ({ action, actor_id: warehouse })));
    await db.query("set local role service_role");
    await rpc("cancel_order", [guestPrior.id, randomUUID(), warehouse]);
    expect(await metric(warehouse)).toBe(base + 2);
    await rpc("record_refund", [purchase.id, randomUUID(), purchaseIntent, 1200, "GBP"]);
    expect(await metric(warehouse)).toBe(base + 1);
    expect(await link(trialId, purchase.id, warehouse)).toBe(trialId);
  });
});

test.each(["trial", "order"] as const)("serializes stock contention when the %s holds the shared variant lock", async (winner) => {
  const trialId = randomUUID();
  const orderToken = randomUUID();
  const workers: Client[] = [];
  let item: Awaited<ReturnType<typeof variant>> | undefined;
  let warehouse: string | undefined;
  let catalogue: string | undefined;
  try {
    await db.query("begin");
    warehouse = await actor("warehouse");
    catalogue = await actor("catalogue");
    item = await variant(warehouse, 2);
    const variantId = item.id;
    const warehouseId = warehouse;
    await submit(trialId);
    await review(trialId, catalogue, [variantId, variantId]);
    await db.query("commit");

    const first = await connect();
    workers.push(first);
    const second = await connect();
    workers.push(second);
    await Promise.all(workers.map((client) => client.query("set role service_role")));
    const firstPid = (await one<{ pid: number }>("select pg_backend_pid() as pid", [], first)).pid;
    const secondPid = (await one<{ pid: number }>("select pg_backend_pid() as pid", [], second)).pid;
    const trialApproval = (client: Client) => approve(trialId, warehouseId, [variantId, variantId], client);
    const checkout = (client: Client) => order(variantId, orderToken, undefined, undefined, client);
    await first.query("begin");
    try {
      const reserved = await (winner === "trial" ? trialApproval(first) : checkout(first));
      const waiting = Promise.allSettled([winner === "trial" ? checkout(second) : trialApproval(second)]);
      try {
        await expect.poll(async () =>
          (await one<{ blocked: boolean }>("select $1 = any(pg_blocking_pids($2)) as blocked", [firstPid, secondPid])).blocked,
        ).toBe(true);
      } finally {
        await first.query("commit");
        await waiting;
      }

      expect(await waiting).toEqual([{
        status: "rejected", reason: expect.objectContaining({ code: "P0001", message: "insufficient_stock", detail: variantId }),
      }]);
      if (typeof reserved !== "string") {
        expect(await outbox(trialId)).toEqual([]);
        await rpc("release_reservation", [reserved.id, randomUUID(), "closed"]);
        expect(await trialApproval(second)).toBe(trialId);
      }
      expect(await stock(variantId)).toEqual({ stock_on_hand: 2, stock_reserved: 2 });
      await db.query("set role anon");
      try {
        expect(await one("select availability from public.variants where id = $1", [variantId])).toEqual({ availability: "out_of_stock" });
      } finally {
        await db.query("reset role");
      }
      expect(await rpc("cancel_trial_fulfilment", [trialId, warehouseId], second)).toBe(trialId);
      expect(await rpc("cancel_trial_fulfilment", [trialId, warehouseId], second)).toBe(trialId);
      await expect(trialApproval(second)).rejects.toMatchObject({ message: "trial_was_cancelled" });
      expect(await stock(variantId)).toEqual({ stock_on_hand: 2, stock_reserved: 0 });
      await db.query("set role anon");
      try {
        expect(await one("select availability from public.variants where id = $1", [variantId])).toEqual({ availability: "in_stock" });
      } finally {
        await db.query("reset role");
      }
      expect(await one("select state, cancelled_by from public.trial_fulfilments where trial_request_id = $1", [trialId]))
        .toEqual({ state: "cancelled", cancelled_by: warehouseId });
      expect((await db.query("select kind, reserved_delta from public.stock_movements where trial_request_id = $1 order by id",
        [trialId])).rows).toEqual([{ kind: "reserve", reserved_delta: 2 }, { kind: "release", reserved_delta: -2 }]);
      expect((await outbox(trialId)).map(({ message_key }) => message_key)).toEqual(["trial_approved"]);
      if (winner === "trial") {
        const retried = await checkout(second);
        await rpc("release_reservation", [retried.id, randomUUID(), "closed"], second);
      }
    } catch (error) {
      await first.query("rollback");
      throw error;
    }
  } finally {
    await Promise.all(workers.map((client) => client.end()));
    await db.query("rollback");
    await db.query("begin");
    try {
      await db.query("delete from public.stock_movements where variant_id = $1", [item?.id]);
      await db.query("delete from public.trial_allocations where trial_request_id = $1", [trialId]);
      await db.query("delete from public.trial_fulfilments where trial_request_id = $1", [trialId]);
      await db.query("delete from public.trial_requests where id = $1", [trialId]);
      for (const table of ["private.order_operations", "public.stock_reservations", "public.order_items"]) {
        await db.query(`delete from ${table} where order_id in (select id from public.orders where checkout_attempt_token = $1)`,
          [orderToken]);
      }
      await db.query("delete from public.orders where checkout_attempt_token = $1", [orderToken]);
      await db.query("delete from public.variants where id = $1", [item?.id]);
      await db.query("delete from public.products where id = $1", [item?.family]);
      await db.query("delete from auth.users where id in ($1, $2)", [warehouse, catalogue]);
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  }
});
