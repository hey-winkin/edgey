import { randomUUID } from "node:crypto";
import { Client, type QueryResultRow } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { setDbClaims } from "../helpers/db-claims";

type Role = "warehouse" | "catalogue" | "finance";
type Session = { id: string; aal: "aal1" | "aal2"; sessionId?: string };

let db: Client;

async function connect() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
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

async function session(...roles: Role[]): Promise<Session> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
  for (const role of roles) await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [id, role]);
  if (roles.length) await setDbClaims(db, "authenticated", id, true);
  return { id, aal: roles.length ? "aal2" : "aal1" };
}

async function asStaff<T>(actor: Session | null, run: () => Promise<T>, client = db) {
  const role = actor ? "authenticated" : "anon";
  await client.query("savepoint purchase_request");
  try {
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      role, sub: actor?.id, aal: actor?.aal, session_id: actor?.sessionId ?? actor?.id,
      amr: [{ method: "password" }, { method: "totp" }],
    })]);
    await client.query(`set local role ${role}`);
    const result = await run();
    await client.query("reset role");
    return result;
  } catch (error) {
    await client.query("rollback to savepoint purchase_request");
    throw error;
  } finally {
    await client.query("release savepoint purchase_request");
  }
}

async function variant(option: string | null = null) {
  const sku = `EDG-DB-${randomUUID()}`;
  const name = `Test blade ${sku}`;
  const { id: productId } = await one<{ id: string }>(`
    insert into public.products (family_code, slug, name, tool_category)
    values ($1, lower($1), $2, 'oscillating') returning id
  `, [sku, name]);
  const { id } = await one<{ id: string }>(`
    insert into public.variants (product_id, sku, option_label)
    values ($1, $2, $3) returning id
  `, [productId, sku, option]);
  return { id, productId, sku, name, option };
}

const supplierInput = {
  name: " Test Supplier ", contact_name: " Contact ", email: "contact@example.test", phone: " 01234 ",
  address: "Test address", default_currency: "GBP", lead_time_days: 14, notes: "Private supplier note",
};
const buyerInput = {
  name: " Test Buyer ", address: "  Test buyer address ", email: "buyer@example.test", company_number: "00123", vat_number: null,
};
const order = (supplier_id: string | null = null, overrides: Record<string, unknown> = {}) => ({
  supplier_id, ordered_on: "2026-01-15", expected_on: "2026-02-15", currency: "GBP", exchange_rate: "1",
  shipping_minor: 0, duty_minor: 0, other_minor: 0, import_vat_minor: 0, include_import_vat: null,
  note: "Private order note", ...overrides,
});
const line = (variant_id: string, quantity: number, unit_price_minor: number | null = null) => ({
  variant_id, quantity, unit_price_minor, supplier_part_number: "Test part number", note: "Private line note",
});
const saveSupplier = (input: unknown = supplierInput, id: string | null = null) =>
  one<{ result: string }>("select public.save_staff_supplier($1, $2) as result", [id, JSON.stringify(input)]).then(r => r.result);
const saveBuyer = (input: unknown = buyerInput) =>
  one<{ result: boolean }>("select public.save_staff_purchase_buyer_settings($1) as result", [JSON.stringify(input)]).then(r => r.result);
const save = (id: string | null, revision: number, input: unknown, lines: unknown, client = db) =>
  one<{ result: string }>("select public.save_staff_purchase_order($1, $2, $3, $4) as result",
    [id, revision, JSON.stringify(input), JSON.stringify(lines)], client).then(r => r.result);
const transition = (id: string, revision: number, status: string) =>
  one<{ result: string }>("select public.transition_staff_purchase_order($1, $2, $3) as result", [id, revision, status]).then(r => r.result);
const header = (id: string) => one("select * from public.staff_purchase_orders where id = $1", [id]);
const outstanding = async (variantId: string) => (await db.query(
  "select * from public.staff_purchase_order_outstanding where variant_id = $1 order by number", [variantId],
)).rows;
const denied = { code: "42501" };
const invalid = { code: "22023" };
const revisionConflict = { code: "40001", message: "staff_purchase_order_revision_conflict" };

describe("staff purchase orders", () => {
  beforeEach(() => db.query("begin"));
  afterEach(() => db.query("rollback"));

  test("allows approved staff to read operational data and keeps every financial detail private", async () => {
    const warehouse = await session("warehouse");
    const catalogue = await session("catalogue");
    const finance = await session("finance");
    const buyer = await session();
    const unapproved = { ...catalogue, sessionId: randomUUID() };
    const passwordOnly = { ...catalogue, aal: "aal1" as const };
    const item = await variant();
    const supplierId = await asStaff(catalogue, () => saveSupplier());
    expect(await asStaff(finance, () => saveBuyer())).toBe(true);
    const id = await asStaff(catalogue, () => save(null, 0, order(supplierId), [line(item.id, 6, 125)]));
    for (const [table, column] of [
      ["staff_purchase_orders", "id"], ["staff_purchase_order_lines", "purchase_order_id"], ["staff_purchase_order_events", "purchase_order_id"],
    ]) {
      const read = async () => (await db.query(`select 1 from public.${table} where ${column} = $1`, [id])).rows;
      expect(await asStaff(warehouse, read)).toEqual([]);
      expect(await asStaff(catalogue, read)).toHaveLength(1);
    }
    expect(await asStaff(finance, () => transition(id, 1, "sent"))).toBe(id);

    for (const [table, field, key] of [
      ["staff_purchase_orders", "id", id],
      ["staff_purchase_order_lines", "purchase_order_id", id],
      ["staff_purchase_order_events", "purchase_order_id", id],
      ["staff_purchase_order_outstanding", "purchase_order_id", id],
      ["staff_purchase_order_stock", "variant_id", item.id],
    ]) {
      const read = async () => (await db.query(`select * from public.${table} where ${field} = $1`, [key])).rows;
      await expect(asStaff(null, read)).rejects.toMatchObject(denied);
      for (const actor of [buyer, unapproved, passwordOnly]) expect(await asStaff(actor, read)).toEqual([]);
      for (const actor of [warehouse, catalogue, finance]) {
        const rows = await asStaff(actor, read);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          for (const field of ["supplier_id", "contact_name", "currency", "note", "unit_price_minor", "landed_unit_pence", "before_snapshot"]) {
            expect(row).not.toHaveProperty(field);
          }
        }
      }
    }

    for (const table of ["staff_suppliers", "staff_purchase_buyer_settings", "staff_purchase_order_costs",
      "staff_purchase_order_line_costs"]) {
      const read = async () => (await db.query(`select * from public.${table}`)).rows;
      await expect(asStaff(null, read)).rejects.toMatchObject(denied);
      for (const actor of [warehouse, buyer, unapproved, passwordOnly]) expect(await asStaff(actor, read)).toEqual([]);
      for (const actor of [catalogue, finance]) expect((await asStaff(actor, read)).length).toBeGreaterThan(0);
    }

    for (const actor of [null, warehouse, buyer, unapproved, passwordOnly]) {
      await expect(asStaff(actor, () => saveSupplier())).rejects.toMatchObject(denied);
      await expect(asStaff(actor, () => saveBuyer())).rejects.toMatchObject(denied);
      await expect(asStaff(actor, () => save(id, 2, order(supplierId), [line(item.id, 6, 125)]))).rejects.toMatchObject(denied);
      await expect(asStaff(actor, () => transition(id, 2, "closed"))).rejects.toMatchObject(denied);
    }
    for (const sql of [
      "insert into public.staff_purchase_orders default values",
      "update public.staff_purchase_order_lines set received_quantity = 99",
      "delete from public.staff_purchase_order_costs",
      "update public.staff_suppliers set name = 'edit'",
      "delete from public.staff_purchase_buyer_settings",
      "delete from public.staff_purchase_order_events",
    ]) await expect(asStaff(catalogue, () => db.query(sql))).rejects.toMatchObject(denied);
    for (const actor of [warehouse, catalogue, finance]) {
      await expect(asStaff(actor, () => db.query("select * from private.staff_purchase_order_amendments")))
        .rejects.toMatchObject(denied);
      await expect(asStaff(actor, () => db.query("select private.staff_purchase_order_snapshot($1)", [id])))
        .rejects.toMatchObject(denied);
    }
  });

  test("validates and updates supplier and singleton buyer settings without inventing data", async () => {
    const actor = await session("finance");
    const id = await asStaff(actor, () => saveSupplier());
    expect(await one("select * from public.staff_suppliers where id = $1", [id])).toMatchObject({
      name: "Test Supplier", contact_name: "Contact", email: "contact@example.test", phone: "01234", lead_time_days: 14,
    });
    expect(await asStaff(actor, () => saveSupplier({ name: "Renamed", default_currency: null, notes: " " }, id))).toBe(id);
    expect(await one("select * from public.staff_suppliers where id = $1", [id])).toMatchObject({
      name: "Renamed", default_currency: null, notes: null, contact_name: null, lead_time_days: null,
    });
    for (const input of [null, [], { ...supplierInput, lead_time_days: 1.1 }, { ...supplierInput, email: "invalid" },
      { ...supplierInput, name: " " }, { ...supplierInput, default_currency: "JPY" }, { ...supplierInput, id }]) {
      await expect(asStaff(actor, () => saveSupplier(input))).rejects.toMatchObject(invalid);
    }
    await expect(asStaff(actor, () => saveSupplier(supplierInput, randomUUID())))
      .rejects.toMatchObject({ message: "staff_supplier_not_found" });
    await asStaff(actor, () => saveBuyer());
    const settings = { id: true, ...buyerInput, name: "Test Buyer", address: "Test buyer address" };
    expect(await one("select * from public.staff_purchase_buyer_settings")).toEqual(settings);
    await asStaff(actor, () => saveBuyer({ ...buyerInput, email: null, vat_number: "GB 123" }));
    expect(await one("select * from public.staff_purchase_buyer_settings")).toEqual({ ...settings, email: null, vat_number: "GB 123" });
    await asStaff(actor, () => saveBuyer({ name: " ", address: "" }));
    expect(await one("select * from public.staff_purchase_buyer_settings")).toEqual({
      id: true, name: null, address: null, email: null, company_number: null, vat_number: null,
    });
    await expect(asStaff(actor, () => saveBuyer({ ...buyerInput, id: false }))).rejects.toMatchObject(invalid);
  });

  test("allows incomplete drafts, assigns sequential numbers transactionally, and validates exact send prerequisites", async () => {
    const actor = await session("catalogue");
    const supplierId = await asStaff(actor, () => saveSupplier());
    const item = await variant("45°");
    const id = randomUUID();
    const foreign = order(supplierId, { currency: "USD", exchange_rate: null, import_vat_minor: 46 });
    const incomplete = { code: "22023", message: "staff_purchase_order_incomplete" };
    expect(await asStaff(actor, () => save(id, 0, order(), []))).toBe(id);
    const first = await header(id);
    expect(first).toMatchObject({ status: "draft", number: expect.stringMatching(/^PO-\d{4,}$/), revision: 1 });
    await expect(asStaff(actor, () => transition(id, 1, "sent"))).rejects.toMatchObject(incomplete);
    await expect(asStaff(actor, () => save(id, 0, order(), []))).rejects.toMatchObject(revisionConflict);
    await expect(asStaff(actor, () => save(null, 0, order(), [line(item.id, 0)]))).rejects.toMatchObject(invalid);

    const next = await asStaff(actor, () => save(null, 0, order(), [line(item.id, 1, 101)]));
    expect((await header(next)).number).toBe(`PO-${String(Number(first.number.slice(3)) + 1).padStart(4, "0")}`);
    await expect(asStaff(actor, () => transition(next, 1, "sent"))).rejects.toMatchObject(incomplete);

    const missing = [
      { input: foreign, price: null },
      { input: foreign, price: 101 },
      { input: { ...foreign, exchange_rate: "0.80" }, price: 101 },
      { input: { ...foreign, exchange_rate: "0.80", include_import_vat: true }, price: 0 },
    ];
    for (const [i, { input, price }] of missing.entries()) {
      const revision = i + 1;
      await asStaff(actor, () => save(id, revision, input, [line(item.id, 1, price)]));
      expect(await one("select base_unit_pence, landed_unit_pence from public.staff_purchase_order_line_costs where purchase_order_id = $1", [id]))
        .toEqual({ base_unit_pence: null, landed_unit_pence: null });
      await expect(asStaff(actor, () => transition(id, revision + 1, "sent"))).rejects.toMatchObject(incomplete);
    }
    const final = { ...foreign, exchange_rate: "0.8", include_import_vat: false };
    await asStaff(actor, () => save(id, 5, final, [line(item.id, 1, 101)]));
    expect(await asStaff(actor, () => transition(id, 6, "sent"))).toBe(id);
    await expect(asStaff(actor, () => transition(id, 6, "closed"))).rejects.toMatchObject(revisionConflict);
    expect(await header(id)).toMatchObject({ status: "sent", revision: 7 });
    expect(await outstanding(item.id)).toMatchObject([{ purchase_order_id: id, quantity: "1" }]);
  });

  test("rejects invalid dates, currency, exchange, amounts, payload shape, and line variants atomically", async () => {
    const actor = await session("catalogue");
    const item = await variant();
    const supplierId = await asStaff(actor, () => saveSupplier());
    const id = await asStaff(actor, () => save(null, 0, order(supplierId), [line(item.id, 5, 100)]));
    const before = await header(id);
    const valid = order(supplierId);
    for (const patch of [
      { ordered_on: "2026-02-30" }, { ordered_on: null }, { expected_on: "infinity" }, { currency: "JPY" },
      { exchange_rate: 1 }, { exchange_rate: "1.25" }, { currency: "EUR", exchange_rate: "NaN" },
      { currency: "EUR", exchange_rate: "0.000000001" }, { currency: "EUR", exchange_rate: "1000001" },
      { currency: "EUR", exchange_rate: "0" }, { shipping_minor: -1 }, { shipping_minor: "10" },
      { shipping_minor: 2.5 }, { duty_minor: 2147483648 }, { include_import_vat: "false" }, { note: {} },
      { supplier_id: "nope" }, { supplier_id: randomUUID() }, { status: "received" },
    ]) await expect(asStaff(actor, () => save(id, 1, { ...valid, ...patch }, [line(item.id, 2, 10)]))).rejects.toMatchObject(invalid);
    for (const lines of [
      null, {}, [null], [line("nope", 1)], [line(randomUUID(), 1)], [line(item.id, -1)], [line(item.id, 1.5)],
      [line(item.id, 2147483648)], [line(item.id, 1, -1)], [{ ...line(item.id, 1), received_quantity: 1 }],
      [line(item.id, 1), line(item.id, 2)], Array.from({ length: 201 }, () => line(item.id, 1)),
    ]) await expect(asStaff(actor, () => save(id, 1, valid, lines))).rejects.toMatchObject(invalid);
    await expect(asStaff(actor, () => save(id, 1, { ...valid, currency: "USD", exchange_rate: "1000000" },
      [line(item.id, 2, 2147483647)]))).rejects.toMatchObject({ message: "staff_purchase_cost_overflow" });
    expect(await header(id)).toEqual(before);
    expect(await one("select quantity from public.staff_purchase_order_lines where purchase_order_id = $1", [id])).toEqual({ quantity: 5 });
    expect(await one("select count(*)::int as count from public.staff_purchase_order_events where purchase_order_id = $1", [id]))
      .toEqual({ count: 1 });
  });

  test("allocates by goods value, rounds landed cost once, and preserves VAT excluded from that cost", async () => {
    const actor = await session("catalogue", "finance");
    const supplierId = await asStaff(actor, () => saveSupplier());
    const a = await variant();
    const b = await variant();
    const input = order(supplierId, {
      currency: "USD", exchange_rate: "0.5", shipping_minor: 10, duty_minor: 25, other_minor: 6,
      import_vat_minor: 35, include_import_vat: false,
    });
    const lines = [line(a.id, 2, 1), line(b.id, 3, 6)];
    const id = await asStaff(actor, () => save(null, 0, input, lines));
    const components = async () => (await db.query(`
      select base_unit_pence, freight_unit_pence, duty_unit_pence, other_unit_pence, vat_unit_pence, landed_unit_pence
      from public.staff_purchase_order_line_costs c join public.staff_purchase_order_lines l using (purchase_order_id, variant_id)
      where l.purchase_order_id = $1 order by l.position
    `, [id])).rows;
    const first = { base_unit_pence: 1, freight_unit_pence: 0, duty_unit_pence: 1, other_unit_pence: 0, vat_unit_pence: 1 };
    const second = { base_unit_pence: 3, freight_unit_pence: 2, duty_unit_pence: 4, other_unit_pence: 1, vat_unit_pence: 5 };
    expect(await components()).toEqual([{ ...first, landed_unit_pence: 2 }, { ...second, landed_unit_pence: 9 }]);
    await asStaff(actor, () => save(id, 1, { ...input, include_import_vat: true }, lines));
    expect(await components()).toEqual([{ ...first, landed_unit_pence: 2 }, { ...second, landed_unit_pence: 14 }]);
  });

  test("locks sent supplier and currency, preserves snapshots, and audits the amendment that consumes remaining balance", async () => {
    const actor = await session("finance");
    const supplierId = await asStaff(actor, () => saveSupplier());
    const anotherSupplier = await asStaff(actor, () => saveSupplier());
    const a = await variant("45°");
    const b = await variant();
    const input = order(supplierId);
    const lines = [line(a.id, 5, 120), line(b.id, 6, 180)];
    const id = await asStaff(actor, () => save(null, 0, input, lines));
    await asStaff(actor, () => transition(id, 1, "sent"));
    await db.query("update public.products set name = 'Renamed' where id = $1", [a.productId]);
    await db.query("update public.variants set sku = $2, option_label = 'New option' where id = $1", [a.id, randomUUID()]);

    await asStaff(actor, () => save(id, 2, input, [lines[1], lines[0]]));
    expect(await one("select sku, blade_name, option_label, position from public.staff_purchase_order_lines where purchase_order_id = $1 and variant_id = $2",
      [id, a.id])).toEqual({ sku: a.sku, blade_name: a.name, option_label: a.option, position: 2 });
    await expect(asStaff(actor, () => save(id, 3, { ...input, supplier_id: anotherSupplier }, lines)))
      .rejects.toMatchObject({ message: "staff_purchase_order_supplier_currency_locked" });
    await expect(asStaff(actor, () => save(id, 3, { ...input, currency: "USD" }, lines)))
      .rejects.toMatchObject({ message: "staff_purchase_order_supplier_currency_locked" });
    await expect(asStaff(actor, () => save(id, 3, input, [line(a.id, 5)])))
      .rejects.toMatchObject({ message: "staff_purchase_order_incomplete" });

    await db.query("update public.staff_purchase_order_lines set received_quantity = 3 where purchase_order_id = $1 and variant_id = $2", [id, a.id]);
    await db.query("update public.staff_purchase_orders set status = 'part_received' where id = $1", [id]);
    await expect(asStaff(actor, () => transition(id, 3, "cancelled")))
      .rejects.toMatchObject({ message: "staff_purchase_order_invalid_transition" });
    for (const reduced of [[line(a.id, 2, 120)], [lines[1]]]) {
      await expect(asStaff(actor, () => save(id, 3, input, reduced)))
        .rejects.toMatchObject({ message: "staff_purchase_order_below_received" });
    }
    const amended = { ...input, note: "Revised private note" };
    expect(await asStaff(actor, () => save(id, 3, amended, [line(a.id, 3, 150)]))).toBe(id);
    expect(await header(id)).toMatchObject({ status: "received", revision: 4, document_revision: 3 });
    expect(await outstanding(a.id)).toEqual([]);
    expect(await outstanding(b.id)).toEqual([]);
    expect(await one(`
      select e.kind, e.actor_id, a.before_snapshot, a.after_snapshot
      from public.staff_purchase_order_events e join private.staff_purchase_order_amendments a on e.id = a.event_id
      where e.purchase_order_id = $1 and e.revision = 4
    `, [id])).toMatchObject({
      kind: "amended", actor_id: actor.id,
      before_snapshot: {
        order: { status: "part_received", revision: 3 }, costs: { note: input.note, supplier_id: supplierId },
        lines: [expect.objectContaining({ variant_id: b.id }), expect.objectContaining({
          variant_id: a.id, received_quantity: 3, quantity: 5, costs: expect.objectContaining({ unit_price_minor: 120 }),
        })],
      },
      after_snapshot: {
        order: { status: "received", revision: 4 }, costs: { note: amended.note, supplier_id: supplierId },
        lines: [expect.objectContaining({
          variant_id: a.id, received_quantity: 3, quantity: 3, costs: expect.objectContaining({ unit_price_minor: 150 }),
        })],
      },
    });
    await asStaff(actor, () => transition(id, 4, "closed"));
    await expect(asStaff(actor, () => save(id, 5, amended, [line(a.id, 3, 150)])))
      .rejects.toMatchObject({ message: "staff_purchase_order_not_editable" });
  });

  test("aggregates only positive open balances across multiple orders and preserves missing expected dates", async () => {
    const actor = await session("catalogue");
    const warehouse = await session("warehouse");
    const item = await variant();
    const supplierId = await asStaff(actor, () => saveSupplier());
    const stock = () => one("select variant_id, quantity, expected_on::text, has_undated from public.staff_purchase_order_stock where variant_id = $1",
      [item.id]);
    const create = (quantity: number, expected_on: string | null) =>
      asStaff(actor, () => save(null, 0, order(supplierId, { expected_on }), [line(item.id, quantity, 100)]));
    const dated = await create(12, "2026-02-05");
    const later = await create(7, "2026-02-16");
    const undated = await create(4, null);
    const draft = await create(30, "2026-01-17");
    for (const id of [dated, later, undated]) await asStaff(actor, () => transition(id, 1, "sent"));
    await db.query("update public.staff_purchase_order_lines set received_quantity = 10 where purchase_order_id = $1", [dated]);
    await db.query("update public.staff_purchase_orders set status = 'part_received' where id = $1", [dated]);
    expect(await asStaff(warehouse, stock)).toEqual({
      variant_id: item.id, quantity: "13", expected_on: "2026-02-05", has_undated: true,
    });
    await asStaff(actor, () => transition(dated, 2, "closed"));
    await asStaff(actor, () => transition(undated, 2, "cancelled"));
    await asStaff(actor, () => transition(draft, 1, "cancelled"));
    expect(await asStaff(warehouse, stock)).toEqual({
      variant_id: item.id, quantity: "7", expected_on: "2026-02-16", has_undated: false,
    });
    expect(await header(dated)).toMatchObject({ status: "closed", revision: 3 });
    await expect(asStaff(actor, () => transition(dated, 3, "sent")))
      .rejects.toMatchObject({ message: "staff_purchase_order_invalid_transition" });
  });
});

test("serializes concurrent edits on the PO and rejects the second edit's stale revision", async () => {
  const worker = await connect();
  const id = randomUUID();
  let actor: Session | undefined;
  try {
    await db.query("begin");
    actor = await session("finance");
    await db.query(`
      insert into public.staff_purchase_orders (id, number, status, ordered_on, revision)
      values ($1, $2, 'draft', '2026-01-15', 1)
    `, [id, `PO-TEST-${id}`]);
    await db.query("commit");
    const actorSession = actor;
    const { pid } = await one<{ pid: number }>("select pg_backend_pid() as pid", [], worker);
    await db.query("begin");
    await worker.query("begin");
    await asStaff(actorSession, () => save(id, 1, order(null, { note: "First edit" }), []));
    const waiting = Promise.allSettled([
      asStaff(actorSession, () => save(id, 1, order(null, { note: "Second edit" }), [], worker), worker),
    ]);
    try {
      await expect.poll(async () => (await one<{ blocked: boolean }>(
        "select pg_backend_pid() = any(pg_blocking_pids($1)) as blocked", [pid],
      )).blocked, { timeout: 4000 }).toBe(true);
    } finally {
      await db.query("commit");
      const [result] = await waiting;
      expect(result).toMatchObject({ status: "rejected", reason: revisionConflict });
    }
    expect(await header(id)).toMatchObject({ revision: 2 });
    expect(await one("select note from public.staff_purchase_order_costs where purchase_order_id = $1", [id]))
      .toEqual({ note: "First edit" });
  } finally {
    await worker.end();
    await db.query("rollback");
    await db.query("begin");
    try {
      await db.query("delete from public.staff_purchase_order_events where purchase_order_id = $1", [id]);
      await db.query("delete from public.staff_purchase_order_costs where purchase_order_id = $1", [id]);
      await db.query("delete from public.staff_purchase_orders where id = $1", [id]);
      if (actor) await db.query("delete from auth.users where id = $1", [actor.id]);
      await db.query("commit");
    } finally {
      await db.query("rollback");
    }
  }
});
