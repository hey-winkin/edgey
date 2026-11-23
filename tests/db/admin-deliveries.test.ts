import { randomUUID } from "node:crypto";
import { Client, type QueryResultRow } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { setDbClaims } from "../helpers/db-claims";

type Role = "warehouse" | "catalogue" | "finance";
type Session = { id: string; aal: "aal1" | "aal2"; sessionId?: string };

let db: Client;

async function connect() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("These tests need the local Supabase stack. Run pnpm db:start && pnpm db:env.");
  }
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000, statement_timeout: 8000 });
  await client.connect();
  return client;
}

beforeAll(async () => { db = await connect(); });
afterAll(() => db?.end());

async function one<Row extends QueryResultRow>(sql: string, params: unknown[] = [], client = db) {
  const { rows } = await client.query<Row>(sql, params);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function staff(...roles: Role[]): Promise<Session> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
  for (const role of roles) await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [id, role]);
  if (roles.length) await setDbClaims(db, "authenticated", id, true);
  return { id, aal: roles.length ? "aal2" : "aal1" };
}

async function asStaff<T>(session: Session | null, run: () => Promise<T>, client = db) {
  const role = session ? "authenticated" : "anon";
  await client.query("savepoint staff_request");
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      role, sub: session?.id, aal: session?.aal, session_id: session?.sessionId ?? session?.id,
      amr: [{ method: "password" }, { method: "totp" }],
    })]);
    await client.query(`set local role ${role}`);
    const result = await run();
    await client.query("reset role");
    return result;
  } catch (error) {
    await client.query("rollback to savepoint staff_request");
    throw error;
  } finally {
    await client.query("release savepoint staff_request");
  }
}

async function variant(status: "draft" | "published" | "archived" = "draft", optionLabel?: string) {
  const sku = `EDG-DB-${randomUUID()}`;
  const productName = `Test blade ${sku}`;
  const supplierPart = `OM-${randomUUID()}`;
  const { id: family } = await one<{ id: string }>(`
    insert into public.products (family_code, slug, name, tool_category)
    values ($1, lower($1), $2, 'oscillating') returning id
  `, [sku, productName]);
  const { id } = await one<{ id: string }>(`
    insert into public.variants (
      product_id, sku, publication_status, supplier_part_number, supplier_name, approved_at, option_label,
      evidence_source, price_1_4_pence, price_5_9_pence, price_10_plus_pence
    ) values ($1, $2, $3, $4, 'Delivery Test Supplier', now(), $5, 'Test evidence', 1000, 900, 800) returning id
  `, [family, sku, status, supplierPart, optionLabel]);
  return { id, family, sku, bladeName: optionLabel ? `${productName} · ${optionLabel}` : productName, supplierPart };
}

const date = "2026-01-15";
const reference = "Reference 13";
const line = (variant_id: string, quantity: number, unit_cost_pence: number | null = null) =>
  ({ variant_id, quantity, unit_cost_pence });
const receive = (id: string | null, lines: unknown, details: {
  reference?: string | null; date?: string | null; note?: string | null;
} = {}, client = db) => one<{ result: string }>(
  "select public.receive_staff_delivery($1, $2, $3, $4, $5) as result",
  [id, details.reference === undefined ? reference : details.reference,
    details.date === undefined ? date : details.date, details.note ?? null, JSON.stringify(lines)],
  client,
).then(({ result }) => result);
const addCost = (id: string, position: number, cost: number | null, client = db) => one<{ result: string }>(
  "select public.add_staff_delivery_line_cost($1, $2, $3) as result", [id, position, cost], client,
).then(({ result }) => result);
const match = async (codes: (string | null)[] | string[][] | null) => (await db.query(
  "select * from public.match_staff_delivery_codes($1)", [codes],
)).rows;
const stock = (id: string) => one(
  "select stock_on_hand, stock_reserved, publication_status from public.variants where id = $1", [id],
);
const legacyReceive = (variantId: string, key: string, quantity: number, actorId: string) => one<{ id: string }>(
  "select id from public.receive_stock($1, $2, $3, $4)", [variantId, key, quantity, actorId],
);

describe("staff deliveries", () => {
  beforeEach(() => db.query("begin"));
  afterEach(() => db.query("rollback"));

  test("enforces approved sessions, separates roles, and never exposes receipt costs to warehouse", async () => {
    const warehouse = await staff("warehouse");
    const catalogue = await staff("catalogue");
    const finance = await staff("finance");
    const buyer = await staff();
    const unapproved = { ...warehouse, sessionId: randomUUID() };
    const combined = await staff("warehouse", "finance");
    const item = await variant();
    const id = randomUUID();
    const denied = { code: "42501" };
    const run = () => receive(id, [line(item.id, 1)]);
    const importMatch = () => match([item.sku]);
    const schema = ["staff_deliveries", "staff_delivery_lines"];

    for (const viewer of [null, buyer, { ...warehouse, aal: "aal1" } as const, unapproved, catalogue, finance]) {
      await expect(asStaff(viewer, run)).rejects.toMatchObject(denied);
      await expect(asStaff(viewer, importMatch)).rejects.toMatchObject(denied);
    }
    await expect(asStaff(warehouse, () => receive(id, [line(item.id, 1, 0)]))).rejects.toMatchObject(denied);
    expect(await asStaff(warehouse, run)).toBe(id);
    expect(await asStaff(warehouse, importMatch)).toEqual([{
      input_code: item.sku, variant_id: item.id, sku: item.sku, blade_name: item.bladeName,
    }]);
    await expect(asStaff(warehouse, () => addCost(id, 1, 80))).rejects.toMatchObject(denied);
    expect(await asStaff(finance, () => addCost(id, 1, 80))).toEqual(expect.any(String));
    expect(await asStaff(catalogue, () => addCost(id, 1, 80))).toEqual(expect.any(String));
    const costedId = randomUUID();
    expect(await asStaff(combined, () => receive(costedId, [line(item.id, 1, 90)]))).toBe(costedId);

    for (const table of schema) {
      const query = async () => (await db.query(
        table === "staff_deliveries" ? "select * from public.staff_deliveries where id = $1"
          : "select * from public.staff_delivery_lines where delivery_id = $1", [id],
      )).rows;
      await expect(asStaff(null, query)).rejects.toMatchObject(denied);
      for (const session of [buyer, unapproved]) expect(await asStaff(session, query)).toEqual([]);
      for (const session of [warehouse, catalogue, finance]) expect(await asStaff(session, query)).toHaveLength(1);
      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set ${table === "staff_deliveries" ? "reference = 'edited'" : "quantity = 9"}`,
        `delete from public.${table}`,
      ]) await expect(asStaff(combined, () => db.query(sql))).rejects.toMatchObject(denied);
    }

    for (const session of [warehouse, catalogue, finance, combined]) {
      await expect(asStaff(session, () => db.query("select * from private.staff_delivery_payloads")))
        .rejects.toMatchObject(denied);
    }
    const costs = async () => (await db.query(
      "select * from public.staff_effective_receipt_costs where variant_id = $1", [item.id],
    )).rows;
    expect(await asStaff(warehouse, costs)).toEqual([]);
    expect(await asStaff(finance, costs)).toHaveLength(2);
  });

  test("records ordered line snapshots and stock movements once, without publishing or colliding with legacy receipts", async () => {
    const actor = await staff("warehouse", "catalogue");
    const other = await staff("warehouse", "finance");
    const draft = await variant("draft", "45°");
    const published = await variant("published");
    const id = randomUUID();
    const receipt = await legacyReceive(draft.id, `staff-delivery:${id}:1`, 7, actor.id);
    await db.query("update public.variants set stock_reserved = 2 where id = $1", [draft.id]);
    const lines = [line(draft.id, 4, 320), line(published.id, 2)];

    const create = () => receive(id, lines, { reference: " Reference 13 ", note: "  Packed separately.  " });
    expect(await asStaff(actor, create)).toBe(id);
    expect(await one("select * from public.staff_deliveries where id = $1", [id])).toEqual({
      id, reference, received_on: expect.any(Date), received_at: expect.any(Date), note: "Packed separately.",
      actor_id: actor.id, line_count: 2, unit_count: "6",
    });
    expect(await stock(draft.id)).toEqual({ stock_on_hand: 11, stock_reserved: 2, publication_status: "draft" });
    expect(await stock(published.id)).toEqual({ stock_on_hand: 2, stock_reserved: 0, publication_status: "published" });
    await db.query("update public.products set name = 'Renamed afterwards' where id = $1", [draft.family]);
    await db.query("update public.variants set sku = $2, option_label = 'Changed', publication_status = 'archived' where id = $1", [draft.id, randomUUID()]);
    expect(await asStaff(actor, create)).toBe(id);
    for (const attempt of [
      () => asStaff(other, create),
      () => asStaff(actor, () => receive(id, [...lines].reverse(), { note: "Packed separately." })),
      () => asStaff(actor, () => receive(id, lines, { reference: "Different", note: "Packed separately." })),
      () => asStaff(actor, () => receive(id, lines, { date: "2026-01-14", note: "Packed separately." })),
      () => asStaff(actor, () => receive(id, lines, { note: "Changed" })),
      () => asStaff(actor, () => receive(id, [line(draft.id, 4, 321), lines[1]], { note: "Packed separately." })),
    ]) await expect(attempt()).rejects.toMatchObject({ message: "operation_key_conflict" });

    const { rows } = await db.query(`
      select l.position, l.variant_id, l.sku, l.blade_name, l.quantity, l.stock_movement_id,
        m.kind, m.actor_id, m.on_hand_delta, m.on_hand_before, m.on_hand_after, m.reserved_before, m.reserved_after
      from public.staff_delivery_lines l join public.stock_movements m on m.id = l.stock_movement_id
      where l.delivery_id = $1 order by l.position
    `, [id]);
    expect(rows).toEqual([
      {
        position: 1, variant_id: draft.id, sku: draft.sku, blade_name: draft.bladeName, quantity: 4,
        stock_movement_id: expect.any(String), kind: "receive", actor_id: actor.id,
        on_hand_delta: 4, on_hand_before: 7, on_hand_after: 11, reserved_before: 2, reserved_after: 2,
      },
      {
        position: 2, variant_id: published.id, sku: published.sku, blade_name: published.bladeName, quantity: 2,
        stock_movement_id: expect.any(String), kind: "receive", actor_id: actor.id,
        on_hand_delta: 2, on_hand_before: 0, on_hand_after: 2, reserved_before: 0, reserved_after: 0,
      },
    ]);
    expect(rows[0]!.stock_movement_id).not.toBe(receipt.id);
    expect(await one(`
      select received_quantity, supplier_unit_minor, currency, landed_unit_pence, actor_id
      from public.staff_effective_receipt_costs where stock_movement_id = $1
    `, [rows[0]!.stock_movement_id])).toEqual({
      received_quantity: 4, supplier_unit_minor: 320, currency: "GBP", landed_unit_pence: 320, actor_id: actor.id,
    });
    expect(await one("select count(*)::int as count from public.stock_movements where variant_id = $1", [draft.id]))
      .toEqual({ count: 2 });
  });

  test("rolls back the whole delivery when a later line is missing, archived, overflowing or has invalid cost", async () => {
    const actor = await staff("warehouse", "finance");
    const [first, second] = [await variant(), await variant()].sort((a, b) => a.id < b.id ? -1 : 1);
    const archived = await variant("archived");
    await legacyReceive(second!.id, randomUUID(), 2147483647, actor.id);
    const id = randomUUID();
    for (const [bad, message] of [
      [line(randomUUID(), 1), "delivery_variant_unavailable"],
      [line(archived.id, 1), "delivery_variant_unavailable"],
      [line(second!.id, 1), "delivery_stock_overflow"],
      [line(second!.id, 1, -10), "delivery_stock_overflow"],
    ] as const) {
      await expect(asStaff(actor, () => receive(id, [line(first!.id, 4, 125), bad])))
        .rejects.toMatchObject({ code: "22023", message });
    }
    await db.query("update public.variants set stock_on_hand = 0 where id = $1", [second!.id]);
    await expect(asStaff(actor, () => receive(id, [line(first!.id, 4, 125), line(second!.id, 1, 0.5)])))
      .rejects.toMatchObject({ code: "22023", message: "invalid_staff_cost" });
    expect(await stock(first!.id)).toMatchObject({ stock_on_hand: 0 });
    expect(await stock(archived.id)).toMatchObject({ stock_on_hand: 0 });
    expect(await one(`
      select
        (select count(*)::int from public.staff_deliveries where id = $1) as deliveries,
        (select count(*)::int from private.staff_delivery_payloads where delivery_id = $1) as payloads,
        (select count(*)::int from public.staff_delivery_lines where delivery_id = $1) as lines,
        (select count(*)::int from public.stock_movements where variant_id = $2) as movements,
        (select count(*)::int from public.staff_receipt_costs where variant_id = $2) as costs
    `, [id, first!.id])).toEqual({ deliveries: 0, payloads: 0, lines: 0, movements: 0, costs: 0 });
    expect(await asStaff(actor, () => receive(id, [line(first!.id, 1)]))).toBe(id);
  });

  test("strictly validates dates, headers, quantities, line shape and variants", async () => {
    const actor = await staff("warehouse", "catalogue");
    const item = await variant();
    const id = randomUUID();
    const good = [line(item.id, 1)];
    for (const attempt of [
      () => receive(null, good),
      () => receive(id, good, { date: "infinity" }),
      () => receive(id, good, { date: "2100-01-01" }),
      () => receive(id, good, { date: null }),
      () => receive(id, good, { reference: "  " }),
      () => receive(id, good, { reference: "A\nB" }),
      () => receive(id, good, { reference: "a".repeat(121) }),
      () => receive(id, good, { note: "a".repeat(501) }),
      ...[null, {}, [], Array(201).fill(good[0]), [null], [line("not-uuid", 1)],
        [line(item.id, 0)], [line(item.id, 2147483648)], [line(item.id, 0.5)],
        [{ ...good[0], sku: "EDG-WRONG" }], [{ variant_id: item.id, quantity: 1 }],
        [{ ...good[0], quantity: "1" }],
      ].map((value) => () => receive(id, value)),
    ]) await expect(asStaff(actor, attempt)).rejects.toMatchObject({ code: "22023", message: "invalid_staff_delivery" });
    await expect(asStaff(actor, () => receive(id, [good[0], line(item.id.toUpperCase(), 2)])))
      .rejects.toMatchObject({ code: "22023", message: "delivery_duplicate_variant" });
    for (const value of [-1, 2147483648, 0.5, "20", []]) {
      await expect(asStaff(actor, () => receive(id, [{ ...good[0], unit_cost_pence: value }])))
        .rejects.toMatchObject({ code: "22023", message: "invalid_staff_cost" });
    }
    expect(await stock(item.id)).toMatchObject({ stock_on_hand: 0 });
    expect(await asStaff(actor, () => receive(id, good, { note: " \t\n" }))).toBe(id);
    expect(await one("select note from public.staff_deliveries where id = $1", [id])).toEqual({ note: null });
  });

  test("supports the full stock integer limit per line even when a delivery total exceeds it", async () => {
    const actor = await staff("warehouse");
    const first = await variant();
    const second = await variant();
    const id = randomUUID();
    const lines = [line(first.id, 2147483647), line(second.id, 2147483647)];
    expect(await asStaff(actor, () => receive(id, lines))).toBe(id);
    expect(await asStaff(actor, () => receive(id, lines))).toBe(id);
    expect(await one("select unit_count from public.staff_deliveries where id = $1", [id])).toEqual({ unit_count: "4294967294" });
    for (const item of [first, second]) expect(await stock(item.id)).toMatchObject({ stock_on_hand: 2147483647 });
  });

  test("records a late cost once and preserves the original and its correction across retries", async () => {
    const warehouse = await staff("warehouse");
    const catalogue = await staff("catalogue");
    const finance = await staff("finance");
    const item = await variant();
    const id = randomUUID();
    await asStaff(warehouse, () => receive(id, [line(item.id, 6)]));
    const { stock_movement_id: movement } = await one<{ stock_movement_id: string }>(
      "select stock_movement_id from public.staff_delivery_lines where delivery_id = $1", [id],
    );
    await expect(asStaff(finance, () => addCost(id, 2, 250))).rejects.toMatchObject({ message: "staff_delivery_line_not_found" });
    for (const invalid of [null, -1]) {
      await expect(asStaff(finance, () => addCost(id, 1, invalid))).rejects.toMatchObject({ message: "invalid_staff_cost" });
    }
    expect(await asStaff(catalogue, () => addCost(id, 1, 250))).toBe(movement);
    expect(await asStaff(catalogue, () => addCost(id, 1, 250))).toBe(movement);
    const original = await one("select * from public.staff_receipt_costs where stock_movement_id = $1", [movement]);
    const { version } = await one(
      "select recorded_at::text as version from public.staff_receipt_costs where stock_movement_id = $1", [movement],
    );
    expect(original).toMatchObject({ actor_id: catalogue.id, landed_unit_pence: 250, supplier_unit_minor: 250, currency: "GBP" });
    await asStaff(finance, () => db.query("select public.correct_staff_receipt_cost($1, $2, $3::timestamptz, $4)", [
      item.id, movement, version,
      JSON.stringify({ supplier_unit_minor: 275, currency: "GBP", landed_unit_pence: 275 }),
    ]));
    expect(await asStaff(finance, () => addCost(id, 1, 250))).toBe(movement);
    await expect(asStaff(finance, () => addCost(id, 1, 275))).rejects.toMatchObject({ message: "staff_delivery_line_already_costed" });
    expect(await asStaff(warehouse, () => receive(id, [line(item.id, 6)]))).toBe(id);
    expect(await one("select * from public.staff_receipt_costs where stock_movement_id = $1", [movement])).toEqual(original);
    expect(await one(`
      select landed_unit_pence, actor_id from public.staff_effective_receipt_costs where stock_movement_id = $1
    `, [movement])).toEqual({ landed_unit_pence: 275, actor_id: finance.id });
    expect(await one("select count(*)::int as count from public.stock_movements where variant_id = $1", [item.id]))
      .toEqual({ count: 1 });
  });

  test("matches bounded exact SKU and maker codes, failing closed on archived, rejected and private references", async () => {
    const warehouse = await staff("warehouse");
    const draft = await variant("draft", "45°");
    const published = await variant("published");
    const archived = await variant("archived");
    await db.query(`
      insert into public.compatibility (variant_id, code, code_kind, brand, verification_state, is_private)
      values
        ($1, 'OEM-17', 'item_number', 'zund', 'candidate', false),
        ($1, 'Model 12', 'model', 'zund', 'candidate', false),
        ($2, 'OEM.17', 'item_number', 'summa', 'candidate', false),
        ($2, $4, 'item_number', 'summa', 'candidate', false),
        ($2, $5, 'item_number', 'summa', 'candidate', false),
        ($1, 'Blocked by archive', 'item_number', 'zund', 'candidate', false),
        ($3, 'Blocked by archive', 'item_number', 'zund', 'candidate', false),
        ($3, 'Only archive', 'item_number', 'zund', 'candidate', false),
        ($2, 'Private maker code', 'item_number', 'summa', 'candidate', true),
        ($2, 'Alias', 'alias', 'summa', 'candidate', true),
        ($2, 'Rejected', 'item_number', 'summa', 'rejected', false)
    `, [draft.id, published.id, archived.id, draft.sku, archived.sku]);
    const requestedSku = draft.sku.toLowerCase().replaceAll("-", "");
    const result = (input_code: string, item: typeof draft) =>
      ({ input_code, variant_id: item.id, sku: item.sku, blade_name: item.bladeName });
    expect(await asStaff(warehouse, () => match([
      requestedSku, "OEM 17", " model-12 ", draft.supplierPart, "Delivery Test Supplier", "Unknown",
      archived.sku, "Blocked by archive", "Only archive", "Private maker code", "Alias", "Rejected", "OEM 17",
    ]))).toEqual([
      result(requestedSku, draft),
      ...[draft, published].sort((a, b) => a.sku < b.sku ? -1 : 1).map((item) => result("OEM 17", item)),
      result(" model-12 ", draft),
    ]);
    expect(await asStaff(warehouse, () => match([]))).toEqual([]);
    for (const codes of [null, [null], ["-"], ["a\nb"], ["x".repeat(121)], [["a"], ["b"]], Array(201).fill("a")]) {
      await expect(asStaff(warehouse, () => match(codes))).rejects.toMatchObject({
        code: "22023", message: "invalid_staff_delivery_codes",
      });
    }
  });

  test("bounds ambiguous matches without downgrading them to unique suggestions", async () => {
    const warehouse = await staff("warehouse");
    const variants = [await variant("archived")];
    for (let i = 0; i < 6; i++) variants.push(await variant());
    const code = "Shared import test reference";
    await db.query(`
      insert into public.compatibility (variant_id, code, code_kind, brand)
      select unnest($1::uuid[]), $2, 'item_number', 'zund'
    `, [variants.map(({ id }) => id), code]);
    const results = await asStaff(warehouse, () => match([code]));
    expect(results).toHaveLength(4);
    expect(results.map((row) => row.variant_id)).not.toContain(variants[0]!.id);
  });
});

describe("concurrent delivery transactions", () => {
  let worker: Client;
  let actor: Session;
  let items: Awaited<ReturnType<typeof variant>>[];
  let deliveries: string[];

  beforeEach(async () => {
    actor = await staff("warehouse", "finance");
    items = [await variant(), await variant()].sort((a, b) => a.id < b.id ? -1 : 1);
    deliveries = [randomUUID(), randomUUID()];
    worker = await connect();
    await db.query("begin");
    await worker.query("begin");
  });

  afterEach(async () => {
    await worker.end();
    await db.query("rollback");
    const ids = items.map((item) => item.id);
    await db.query("begin");
    try {
      await db.query("delete from public.staff_receipt_costs where variant_id = any($1::uuid[])", [ids]);
      await db.query("delete from private.staff_delivery_payloads where delivery_id = any($1::uuid[])", [deliveries]);
      await db.query("delete from public.staff_delivery_lines where delivery_id = any($1::uuid[])", [deliveries]);
      await db.query("delete from public.staff_deliveries where id = any($1::uuid[])", [deliveries]);
      await db.query("delete from public.stock_movements where variant_id = any($1::uuid[])", [ids]);
      await db.query("delete from public.variants where id = any($1::uuid[])", [ids]);
      await db.query("delete from public.products where id = any($1::uuid[])", [items.map(({ family }) => family)]);
      await db.query("delete from auth.users where id = $1", [actor.id]);
      await db.query("commit");
    } finally {
      await db.query("rollback");
    }
  });

  async function blocked<T>(run: () => Promise<T>, whileBlocked?: () => Promise<unknown>) {
    const { pid } = await one<{ pid: number }>("select pg_backend_pid() as pid", [], worker);
    const waiting = Promise.allSettled([run()]);
    try {
      await expect.poll(async () => (await one<{ waiting: boolean }>(
        "select pg_backend_pid() = any(pg_blocking_pids($1)) as waiting", [pid],
      )).waiting, { timeout: 4000 }).toBe(true);
      await whileBlocked?.();
      await db.query("commit");
      const [result] = await waiting;
      return result;
    } finally {
      await db.query("rollback");
      await waiting;
    }
  }

  test("overlapping posts for the same delivery replay without a second stock or cost write", async () => {
    const id = deliveries[0]!;
    const item = items[0]!;
    const lines = [line(item.id, 2, 50)];
    const post = (client: Client) => asStaff(actor, () => receive(id, lines, {}, client), client);
    expect(await post(db)).toBe(id);
    expect(await blocked(() => post(worker))).toEqual({ status: "fulfilled", value: id });
    await worker.query("commit");
    expect(await stock(item.id)).toMatchObject({ stock_on_hand: 2 });
    expect(await one(`
      select
        (select count(*)::int from public.stock_movements where variant_id = $1) as movements,
        (select count(*)::int from public.staff_receipt_costs where variant_id = $1) as costs
    `, [item.id])).toEqual({ movements: 1, costs: 1 });
  });

  test("locks variants in UUID order even when the displayed lines go in another order", async () => {
    const [first, second] = items.map(({ id }) => id) as [string, string];
    await db.query("select id from public.variants where id = $1 for no key update", [first]);
    const [firstDelivery, secondDelivery] = deliveries as [string, string];
    expect(await blocked(
      () => asStaff(actor, () => receive(secondDelivery, [line(second, 3), line(first, 4)], {}, worker), worker),
      async () => {
        await db.query("select id from public.variants where id = $1 for no key update nowait", [second]);
        expect(await asStaff(actor, () => receive(firstDelivery, [line(first, 1), line(second, 2)]))).toBe(firstDelivery);
      },
    )).toEqual({ status: "fulfilled", value: secondDelivery });
    await worker.query("commit");
    for (const item of items) expect(await stock(item.id)).toMatchObject({ stock_on_hand: 5 });
  });

  test("serializes overlapping late costs without replacing the first write", async () => {
    const id = deliveries[0]!;
    const item = items[0]!;
    await asStaff(actor, () => receive(id, [line(item.id, 2)]));
    await db.query("commit");
    await db.query("begin");
    const movement = await asStaff(actor, () => addCost(id, 1, 105));
    expect(await blocked(() => asStaff(actor, () => addCost(id, 1, 110, worker), worker)))
      .toMatchObject({ status: "rejected", reason: { message: "staff_delivery_line_already_costed" } });
    await worker.query("commit");
    expect(await one("select landed_unit_pence from public.staff_receipt_costs where stock_movement_id = $1", [movement]))
      .toEqual({ landed_unit_pence: 105 });
    expect(await stock(item.id)).toMatchObject({ stock_on_hand: 2 });
  });
});
