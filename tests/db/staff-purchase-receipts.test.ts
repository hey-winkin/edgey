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
  await client.query("savepoint staff_request");
  try {
    const role = session ? "authenticated" : "anon";
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

async function variant() {
  const sku = `EDG-DB-${randomUUID()}`;
  const { id: productId } = await one<{ id: string }>(`
    insert into public.products (family_code, slug, name, tool_category)
    values ($1, lower($1), 'Test blade', 'oscillating') returning id
  `, [sku]);
  const { id } = await one<{ id: string }>(`
    insert into public.variants (product_id, sku, publication_status)
    values ($1, $2, 'draft') returning id
  `, [productId, sku]);
  return { id, productId };
}

const orderedLine = (variant_id: string, quantity: number, unit_price_minor = 100) =>
  ({ variant_id, quantity, unit_price_minor });
const receiptLine = (variant_id: string, quantity: number) => ({ variant_id, quantity });
const orderDetails = (supplier_id: string) => ({
  supplier_id, ordered_on: "2026-01-10", expected_on: "2026-01-19",
  currency: "USD", exchange_rate: "0.8", shipping_minor: 80, duty_minor: 40, other_minor: 16,
  import_vat_minor: 32, include_import_vat: true, note: "Private purchasing note",
});
const saveOrder = (id: string | null, revision: number, details: ReturnType<typeof orderDetails>,
  lines: ReturnType<typeof orderedLine>[]) => one<{ id: string }>(
  "select public.save_staff_purchase_order($1, $2, $3, $4) as id",
  [id, revision, JSON.stringify(details), JSON.stringify(lines)],
).then(({ id }) => id);
const transition = (id: string, revision: number, state: string) => one<{ id: string }>(
  "select public.transition_staff_purchase_order($1, $2, $3) as id", [id, revision, state],
);
const supplier = () => one<{ id: string }>(
  "select public.save_staff_supplier(null, $1) as id",
  [JSON.stringify({ name: "Imaginary Blade Supply (test)", default_currency: "USD" })],
).then(({ id }) => id);
const receive = (orderId: string | null, revision: number | null, deliveryId: string, lines: unknown, client = db) =>
  one<{ id: string }>("select public.receive_staff_purchase_order($1, $2, $3, 'Test delivery', '2026-01-15', null, $4) as id",
    [orderId, revision, deliveryId, JSON.stringify(lines)], client).then(({ id }) => id);
const standalone = (deliveryId: string, variantId: string) => one<{ id: string }>(
  "select public.receive_staff_delivery($1, 'Test delivery', '2026-01-15', null, $2) as id",
  [deliveryId, JSON.stringify([{ ...receiptLine(variantId, 1), unit_cost_pence: null }])],
).then(({ id }) => id);
const stats = (orderId: string) => one(
  "select status, revision from public.staff_purchase_orders where id = $1", [orderId],
);
const lastPrice = (supplierId: string, variantId: string, currency = "USD") => one<{ price: number | null }>(
  "select public.last_staff_purchase_price($1, $2, $3) as price", [supplierId, variantId, currency],
).then(({ price }) => price);

async function sentOrder(finance: Session, lines: ReturnType<typeof orderedLine>[]) {
  const supplierId = await asStaff(finance, supplier);
  const details = orderDetails(supplierId);
  const id = await asStaff(finance, () => saveOrder(null, 0, details, lines));
  await asStaff(finance, () => transition(id, 1, "sent"));
  return { id, supplierId, details };
}

describe("receiving against a purchase order", () => {
  beforeEach(() => db.query("begin"));
  afterEach(() => db.query("rollback"));

  test("receives short, over and unexpected quantities, freezes costs, and replays completed orders", async () => {
    const finance = await staff("finance");
    const warehouse = await staff("warehouse");
    const apple = await variant();
    const pear = await variant();
    const plum = await variant();
    const { id, supplierId, details } = await sentOrder(finance, [
      orderedLine(apple.id, 4), orderedLine(pear.id, 2, 200),
    ]);
    const first = randomUUID();
    const second = randomUUID();
    const partial = [receiptLine(apple.id, 2), receiptLine(plum.id, 3)];
    const remaining = [receiptLine(pear.id, 2), receiptLine(apple.id, 3)];
    const lastApplePrice = () => asStaff(finance, () => lastPrice(supplierId, apple.id));
    const documentRevision = () => one("select document_revision from public.staff_purchase_orders where id = $1", [id]);
    const readCost = () => db.query(`
      select d.variant_id, r.supplier_unit_minor, r.currency, r.exchange_rate, r.freight_unit_pence,
        r.duty_unit_pence, r.landed_unit_pence, r.received_quantity
      from public.staff_receipt_costs r
      join public.staff_delivery_lines d using (stock_movement_id)
      where d.delivery_id = $1
    `, [first]).then(({ rows }) => rows);
    const readBreakdown = () => db.query(`
      select b.base_unit_pence, b.freight_unit_pence, b.duty_unit_pence,
        b.other_unit_pence, b.vat_unit_pence, b.include_import_vat
      from public.staff_purchase_receipt_cost_breakdowns b
      join public.staff_delivery_lines d using (stock_movement_id)
      where d.delivery_id = $1
    `, [first]).then(({ rows }) => rows);

    expect(await lastApplePrice()).toBeNull();
    expect(await asStaff(warehouse, () => receive(id, 2, first, partial))).toBe(first);
    expect(await stats(id)).toEqual({ status: "part_received", revision: 3 });
    expect(await documentRevision()).toEqual({ document_revision: 1 });
    expect(await asStaff(warehouse, () => one(
      "select purchase_order_id, line_count, unit_count from public.staff_deliveries where id = $1", [first],
    ))).toEqual({ purchase_order_id: id, line_count: 2, unit_count: "5" });
    expect(await asStaff(warehouse, () => db.query(`
      select variant_id, quantity from public.staff_purchase_order_outstanding where purchase_order_id = $1
    `, [id]).then(({ rows }) => rows))).toEqual(expect.arrayContaining([
      { variant_id: apple.id, quantity: "2" }, { variant_id: pear.id, quantity: "2" },
    ]));
    expect(await asStaff(warehouse, () => readCost())).toEqual([]);
    expect(await asStaff(warehouse, readBreakdown)).toEqual([]);
    await expect(asStaff(null, readBreakdown)).rejects.toMatchObject({ code: "42501" });
    await expect(asStaff(finance, () => db.query(
      "update public.staff_purchase_receipt_cost_breakdowns set base_unit_pence = 0",
    ))).rejects.toMatchObject({ code: "42501" });
    const initialCost = {
      variant_id: apple.id, supplier_unit_minor: 100, currency: "USD", exchange_rate: "0.8",
      freight_unit_pence: 8, duty_unit_pence: 4, landed_unit_pence: 97, received_quantity: 2,
    };
    const initialBreakdown = {
      base_unit_pence: 80, freight_unit_pence: 8, duty_unit_pence: 4,
      other_unit_pence: 2, vat_unit_pence: 3, include_import_vat: true,
    };
    expect(await asStaff(finance, () => readCost())).toEqual([initialCost]);
    expect(await asStaff(finance, readBreakdown)).toEqual([initialBreakdown]);
    expect(await asStaff(finance, () => lastPrice(supplierId, plum.id))).toBeNull();
    expect(await asStaff(finance, () => lastPrice(supplierId, apple.id, "GBP"))).toBeNull();
    await asStaff(finance, () => one(`
      select public.correct_staff_receipt_cost(r.variant_id, r.stock_movement_id, r.recorded_at,
        jsonb_build_object('supplier_unit_minor', 105, 'currency', 'USD',
          'landed_unit_pence', 101, 'exchange_rate', '0.8', 'freight_unit_pence', 8, 'duty_unit_pence', 4))
      from public.staff_receipt_costs r
      join public.staff_delivery_lines d using (stock_movement_id)
      where d.delivery_id = $1 and r.variant_id = $2
    `, [first, apple.id]));
    expect(await asStaff(finance, readBreakdown)).toEqual([initialBreakdown]);

    await asStaff(finance, () => saveOrder(id, 3, details, [
      orderedLine(apple.id, 4, 125), orderedLine(pear.id, 2, 200),
    ]));
    expect(await lastApplePrice()).toBe(100);
    expect(await asStaff(warehouse, () => receive(id, 2, first, partial))).toBe(first);
    expect(await asStaff(warehouse, () => receive(id, 4, second, remaining))).toBe(second);
    expect(await stats(id)).toEqual({ status: "received", revision: 5 });
    expect(await documentRevision()).toEqual({ document_revision: 2 });
    expect(await asStaff(warehouse, () => receive(id, 4, second, remaining))).toBe(second);
    await expect(asStaff(warehouse, () => receive(id, 5, randomUUID(), remaining)))
      .rejects.toMatchObject({ code: "22023", message: "purchase_order_not_receivable" });
    expect(await lastApplePrice()).toBe(125);
    expect(await asStaff(finance, () => readCost())).toEqual([initialCost]);
    expect(await asStaff(finance, readBreakdown)).toEqual([initialBreakdown]);
    expect((await db.query(
      "select variant_id, received_quantity from public.staff_purchase_order_lines where purchase_order_id = $1", [id],
    )).rows).toEqual(expect.arrayContaining([
      { variant_id: apple.id, received_quantity: "5" }, { variant_id: pear.id, received_quantity: "2" },
    ]));
    expect(await one(`
      select
        (select count(*)::int from public.staff_purchase_order_outstanding where purchase_order_id = $1) as outstanding,
        (select count(*)::int from public.staff_deliveries where purchase_order_id = $1) as deliveries,
        (select count(*)::int from public.staff_delivery_lines where delivery_id in ($2, $3)) as movements,
        (select stock_on_hand from public.variants where id = $4) as unexpected_stock
    `, [id, first, second, plum.id])).toEqual({ outstanding: 0, deliveries: 2, movements: 4, unexpected_stock: 3 });
    expect((await asStaff(warehouse, () => db.query(`
      select revision, actor_id from public.staff_purchase_order_events
      where purchase_order_id = $1 and kind = 'receipt' order by revision
    `, [id]))).rows).toEqual([
      { revision: 3, actor_id: warehouse.id }, { revision: 5, actor_id: warehouse.id },
    ]);
  });

  test("rejects stale, invalid and unavailable receipts without writes", async () => {
    const finance = await staff("finance");
    const warehouse = await staff("warehouse");
    const item = await variant();
    const { id } = await sentOrder(finance, [orderedLine(item.id, 2)]);
    const delivery = randomUUID();
    const line = receiptLine(item.id, 1);
    await expect(asStaff(warehouse, () => receive(id, 1, delivery, [line])))
      .rejects.toMatchObject({ code: "22023", message: "purchase_order_stale" });
    await expect(asStaff(warehouse, () => receive(id, 2, delivery, [line, receiptLine(randomUUID(), 1)])))
      .rejects.toMatchObject({ code: "22023", message: "delivery_variant_unavailable" });
    await expect(asStaff(warehouse, () => receive(id, 2, delivery, [line, line])))
      .rejects.toMatchObject({ code: "22023", message: "delivery_duplicate_variant" });
    await expect(asStaff(warehouse, () => receive(null, 2, delivery, [line])))
      .rejects.toMatchObject({ code: "22023", message: "purchase_order_not_found" });
    expect(await stats(id)).toEqual({ status: "sent", revision: 2 });
    expect(await one(`
      select
        (select count(*)::int from public.staff_deliveries where purchase_order_id = $1) as deliveries,
        (select count(*)::int from public.stock_movements where variant_id = $2) as movements,
        (select stock_on_hand from public.variants where id = $2) as stock
    `, [id, item.id])).toEqual({ deliveries: 0, movements: 0, stock: 0 });
    expect(await asStaff(warehouse, () => receive(id, 2, delivery, [line]))).toBe(delivery);
  });

  test("requires approved warehouse access, rejects supplied costs, and scopes replay to the actor and order", async () => {
    const finance = await staff("finance");
    const buyer = await staff();
    const warehouse = await staff("warehouse");
    const combined = await staff("warehouse", "catalogue");
    const item = await variant();
    const { id, supplierId } = await sentOrder(finance, [orderedLine(item.id, 2)]);
    const other = await sentOrder(finance, [orderedLine(item.id, 2)]);
    const delivery = randomUUID();
    const line = receiptLine(item.id, 1);
    const post = () => receive(id, 2, delivery, [line]);
    for (const session of [null, finance, buyer, { ...warehouse, sessionId: randomUUID() }]) {
      await expect(asStaff(session, post)).rejects.toMatchObject({ code: "42501" });
    }
    for (const session of [warehouse, combined]) {
      await expect(asStaff(session, () => receive(id, 2, delivery, [{ ...line, unit_cost_pence: 5 }])))
        .rejects.toMatchObject({ code: "22023", message: "invalid_staff_delivery" });
    }
    expect(await asStaff(warehouse, post)).toBe(delivery);
    await expect(asStaff(warehouse, () => lastPrice(supplierId, item.id))).rejects.toMatchObject({ code: "42501" });
    expect(await asStaff(combined, () => lastPrice(supplierId, item.id))).toBe(100);
    const conflict = { code: "22023", message: "operation_key_conflict" };
    await expect(asStaff(combined, post)).rejects.toMatchObject(conflict);
    await expect(asStaff(warehouse, () => receive(other.id, 2, delivery, [line]))).rejects.toMatchObject(conflict);
    await expect(asStaff(warehouse, () => receive(id, 2, delivery, [receiptLine(item.id, 2)]))).rejects.toMatchObject(conflict);
    await expect(asStaff(warehouse, () => standalone(delivery, item.id))).rejects.toMatchObject(conflict);
    const unlinked = randomUUID();
    expect(await asStaff(warehouse, () => standalone(unlinked, item.id))).toBe(unlinked);
    await expect(asStaff(warehouse, () => receive(id, 3, unlinked, [line]))).rejects.toMatchObject(conflict);
    expect(await stats(id)).toEqual({ status: "part_received", revision: 3 });
    expect(await stats(other.id)).toEqual({ status: "sent", revision: 2 });
  });
});

test("concurrent posts using the same key commit exactly one receipt and one PO revision", async () => {
  const delivery = randomUUID();
  const { finance, warehouse, item, id, supplierId } = await (async () => {
    await db.query("begin");
    try {
      const finance = await staff("finance");
      const warehouse = await staff("warehouse");
      const item = await variant();
      const { id, supplierId } = await sentOrder(finance, [orderedLine(item.id, 1)]);
      await db.query("commit");
      return { finance, warehouse, item, id, supplierId };
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  })();
  const post = (client: Client) => asStaff(warehouse, () => receive(id, 2, delivery, [receiptLine(item.id, 1)], client), client);

  let otherClient: Client | undefined;
  try {
    const worker = otherClient = await connect();
    await db.query("begin");
    await worker.query("begin");
    const { pid } = await one<{ pid: number }>("select pg_backend_pid() as pid", [], worker);
    expect(await post(db)).toBe(delivery);
    const waiting = Promise.allSettled([post(worker)]);
    try {
      await expect.poll(async () => (await one<{ blocked: boolean }>(
        "select pg_backend_pid() = any(pg_blocking_pids($1)) as blocked", [pid],
      )).blocked, { timeout: 4000 }).toBe(true);
      await db.query("commit");
      expect(await waiting).toEqual([{ status: "fulfilled", value: delivery }]);
      await worker.query("commit");
    } finally {
      await db.query("rollback");
      await waiting;
    }
    expect(await stats(id)).toEqual({ status: "received", revision: 3 });
    expect(await one(`
      select
        (select count(*)::int from public.staff_purchase_order_events where purchase_order_id = $1 and kind = 'receipt') as events,
      (select received_quantity from public.staff_purchase_order_lines where purchase_order_id = $1) as received,
      (select count(*)::int from public.stock_movements where variant_id = $2) as movements,
      (select count(*)::int from public.staff_receipt_costs where variant_id = $2) as costs,
      (select count(*)::int from public.staff_purchase_receipt_cost_breakdowns b
        join public.staff_receipt_costs r using (stock_movement_id) where r.variant_id = $2) as breakdowns,
      (select stock_on_hand from public.variants where id = $2) as stock
    `, [id, item.id])).toEqual({ events: 1, received: "1", movements: 1, costs: 1, breakdowns: 1, stock: 1 });
  } finally {
    await otherClient?.end();
    await db.query("rollback");
    await db.query("begin");
    try {
      await db.query(`
        delete from public.staff_purchase_receipt_cost_breakdowns b using public.staff_receipt_costs r
        where b.stock_movement_id = r.stock_movement_id and r.variant_id = $1
      `, [item.id]);
      await db.query("delete from public.staff_receipt_costs where variant_id = $1", [item.id]);
      await db.query("delete from private.staff_delivery_payloads where delivery_id = $1", [delivery]);
      await db.query("delete from public.staff_delivery_lines where delivery_id = $1", [delivery]);
      await db.query("delete from public.staff_deliveries where id = $1", [delivery]);
      await db.query("delete from public.stock_movements where variant_id = $1", [item.id]);
      await db.query("delete from public.staff_purchase_order_events where purchase_order_id = $1", [id]);
      await db.query("delete from public.staff_purchase_order_lines where purchase_order_id = $1", [id]);
      await db.query("delete from public.staff_purchase_order_costs where purchase_order_id = $1", [id]);
      await db.query("delete from public.staff_purchase_orders where id = $1", [id]);
      await db.query("delete from public.staff_suppliers where id = $1", [supplierId]);
      await db.query("delete from public.variants where id = $1", [item.id]);
      await db.query("delete from public.products where id = $1", [item.productId]);
      await db.query("delete from auth.users where id = any($1::uuid[])", [[finance.id, warehouse.id]]);
      await db.query("commit");
    } finally {
      await db.query("rollback");
    }
  }
});
