import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { setDbClaims } from "../helpers/db-claims";

let db: Client;

beforeAll(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("These tests need the local Supabase stack. Run pnpm db:start && pnpm db:env.");
  }
  db = new Client({ connectionString: url, connectionTimeoutMillis: 3000, statement_timeout: 8000 });
  await db.connect();
});
afterAll(() => db?.end());
beforeEach(() => db.query("begin"));
afterEach(() => db.query("rollback"));

async function actor(role: "finance" | "warehouse") {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
  await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [id, role]);
  return id;
}

async function asStaff<T>(id: string, run: () => Promise<T>) {
  await db.query("savepoint purchase_supplier_save");
  try {
    await setDbClaims(db, "authenticated", id, true);
    await db.query("set local role authenticated");
    const result = await run();
    await db.query("reset role");
    return result;
  } catch (error) {
    await db.query("rollback to savepoint purchase_supplier_save");
    throw error;
  } finally {
    await db.query("release savepoint purchase_supplier_save");
  }
}

test("a stale remember rolls back the whole save and a reviewed retry safely commits once", async () => {
  const staff = await actor("finance");
  const warehouse = await actor("warehouse");
  const supplier = randomUUID();
  const product = randomUUID();
  const order = randomUUID();
  const [first, second] = [randomUUID(), randomUUID()].sort();
  await db.query("insert into public.staff_suppliers (id, name) values ($1, 'Atomic supplier test')", [supplier]);
  await db.query(`
    insert into public.products (id, family_code, slug, name, tool_category)
    values ($1::uuid, $1::uuid::text, $1::uuid::text, 'Atomic supplier test blades', 'oscillating')
  `, [product]);
  await db.query("insert into public.variants (id, product_id, sku) values ($1::uuid, $3, $1::uuid::text), ($2::uuid, $3, $2::uuid::text)", [first, second, product]);
  const { rows: [association] } = await db.query<{ version: string }>(`
    insert into public.staff_variant_suppliers (variant_id, supplier_id, supplier_part_number, is_usual)
    values ($1, $2, 'CONCURRENT-PART', true) returning updated_at::text as version
  `, [second, supplier]);
  const header = { supplier_id: supplier, currency: "GBP", ordered_on: "2026-11-20" };
  const list = [first, second].map((variant_id, index) => ({ variant_id, quantity: 1, supplier_part_number: `ORDER-PART-${index}` }));
  const save = (user: string, version: string | null, revision = 0, lines = list) => asStaff(user, () => db.query(`
    select public.save_staff_purchase_order_with_supplier_parts($1, $2, $3, $4, $5) as id
  `, [order, revision, JSON.stringify(header), JSON.stringify(lines), JSON.stringify([
    { variant_id: first, expected_association_updated_at: null },
    { variant_id: second, expected_association_updated_at: version },
  ])]));

  await expect(save(warehouse, null)).rejects.toMatchObject({ code: "42501" });
  await expect(save(staff, null)).rejects.toMatchObject({ code: "40001", message: "staff_variant_supplier_conflict" });
  expect((await db.query("select revision from public.staff_purchase_orders where id = $1", [order])).rows).toEqual([]);
  expect((await db.query("select supplier_part_number from public.staff_variant_suppliers where variant_id = $1", [first])).rows).toEqual([]);
  expect((await db.query("select supplier_part_number from public.staff_variant_suppliers where variant_id = $1", [second])).rows)
    .toEqual([{ supplier_part_number: "CONCURRENT-PART" }]);

  await expect(save(staff, association!.version)).resolves.toMatchObject({ rows: [{ id: order }] });
  await expect(save(staff, association!.version)).rejects.toMatchObject({ code: "40001", message: "staff_purchase_order_revision_conflict" });
  expect((await db.query("select revision from public.staff_purchase_orders where id = $1", [order])).rows).toEqual([{ revision: 1 }]);
  expect((await db.query(`
    select supplier_part_number, is_usual from public.staff_variant_suppliers where variant_id = any($1::uuid[]) order by variant_id
  `, [[first, second]])).rows).toEqual([
    { supplier_part_number: "ORDER-PART-0", is_usual: true },
    { supplier_part_number: "ORDER-PART-1", is_usual: true },
  ]);
});
