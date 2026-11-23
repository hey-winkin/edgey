import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

async function actor(role?: "catalogue" | "finance" | "warehouse", steppedUp = true) {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
  if (role) await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [id, role]);
  if (role && steppedUp) await setDbClaims(db, "authenticated", id, true);
  return { id, steppedUp: Boolean(role && steppedUp) };
}

async function as<T>(session: Awaited<ReturnType<typeof actor>> | null, run: () => Promise<T>) {
  await db.query("savepoint variant_supplier_role");
  try {
    await setDbClaims(db, session ? "authenticated" : "anon", session?.id ?? null, session?.steppedUp);
    await db.query(session ? "set local role authenticated" : "set local role anon");
    const result = await run();
    await db.query("reset role");
    return result;
  } catch (error) {
    await db.query("rollback to savepoint variant_supplier_role");
    throw error;
  } finally {
    await db.query("release savepoint variant_supplier_role");
  }
}

async function supplier(name: string = randomUUID()) {
  const id = randomUUID();
  await db.query("insert into public.staff_suppliers (id, name, default_currency) values ($1, $2, 'GBP')", [id, name]);
  return id;
}

async function variant(name: string | null, part: string | null, published = false) {
  const id = randomUUID();
  await db.query(`
    with product as (
      insert into public.products (family_code, slug, name, tool_category, description)
      values ($1::text, $1::text, 'Supplier test family', 'drag', 'Supplier test description.') returning id
    )
    insert into public.variants (id, product_id, sku, tool, supplier_name, supplier_part_number,
      price_1_4_pence, price_5_9_pence, price_10_plus_pence, publication_status, approved_at, evidence_source)
    select $1::uuid, id, $1::text, 'Holder', $2, $3, 1000, 950, 900,
      (case when $4 then 'published' else 'draft' end)::public.publication_status,
      case when $4 then now() end, case when $4 then 'Fit test' end from product
  `, [id, name, part, published]);
  return id;
}

async function associations(id: string) {
  return (await db.query<{
    supplier_id: string; supplier_part_number: string | null; is_usual: boolean; updated_at: string;
  }>(`
    select supplier_id, supplier_part_number, is_usual, updated_at::text
    from public.staff_variant_suppliers where variant_id = $1 order by is_usual desc
  `, [id])).rows;
}

async function savePo(variantId: string, supplierId: string, part: string | null, id: string | null = null, revision = 0) {
  const result = await db.query<{ id: string }>(
    "select public.save_staff_purchase_order($1, $2, $3, $4) as id",
    [id, revision, { supplier_id: supplierId, currency: "GBP", ordered_on: "2026-11-01" },
      JSON.stringify([{ variant_id: variantId, quantity: 1, supplier_part_number: part }])],
  );
  return result.rows[0]!.id;
}

async function remember(po: string, item: string, revision: number, expected: string | null) {
  const result = await db.query<{ changed: boolean }>(
    "select public.remember_staff_purchase_supplier_part($1, $2, $3, $4) as changed", [po, item, revision, expected],
  );
  return result.rows[0]!.changed;
}

test("migration links unique case/trim matches, without altering legacy text or guessing when ambiguous", async () => {
  const distinctName = `Unique ${randomUUID()}`;
  const ambiguousName = `Ambiguous ${randomUUID()}`;
  const uniqueSupplier = await supplier(`\t${distinctName.toUpperCase()} `);
  await supplier(ambiguousName);
  await supplier(` ${ambiguousName.toLowerCase()}\t`);
  const exact = await variant(`  ${distinctName.toLowerCase()}\t`, "  LEGACY-A  ");
  const ambiguous = await variant(ambiguousName, "LEGACY-B");
  const unmatched = await variant("No registered match", "LEGACY-C");
  const noName = await variant(null, "LEGACY-D");
  const longPart = "P".repeat(121);
  const tooLong = await variant(distinctName, longPart);
  const ids = [exact, ambiguous, unmatched, noName, tooLong];

  const migration = readFileSync("supabase/migrations/20261123203000_variant_usual_suppliers.sql", "utf8");
  const backfill = migration.match(/with registered_names as \([\s\S]+?;/)?.[0];
  expect(backfill).toBeDefined();
  await db.query(backfill!.replace(/;$/, " where v.id = any($1::uuid[])"), [ids]);

  expect(await associations(exact)).toEqual([{
    supplier_id: uniqueSupplier, supplier_part_number: "LEGACY-A", is_usual: true, updated_at: expect.any(String),
  }]);
  for (const id of [ambiguous, unmatched, noName]) expect(await associations(id)).toEqual([]);
  expect(await associations(tooLong)).toEqual([{
    supplier_id: uniqueSupplier, supplier_part_number: null, is_usual: true, updated_at: expect.any(String),
  }]);
  expect((await db.query("select supplier_name, supplier_part_number from public.variants where id = $1", [exact])).rows)
    .toEqual([{ supplier_name: `  ${distinctName.toLowerCase()}\t`, supplier_part_number: "  LEGACY-A  " }]);
  expect((await db.query("select supplier_part_number from public.variants where id = $1", [tooLong])).rows)
    .toEqual([{ supplier_part_number: longPart }]);
});

test("supplier links are visible only to verified catalogue and finance staff; legacy columns are not granted to buyers", async () => {
  const item = await variant("Private supplier", "PRIVATE-PART", true);
  const registered = await supplier();
  await db.query("insert into public.staff_variant_suppliers (variant_id, supplier_id, is_usual) values ($1, $2, true)", [item, registered]);
  const buyer = await actor();
  const warehouse = await actor("warehouse");
  const catalogue = await actor("catalogue");
  const finance = await actor("finance");
  const unverifiedFinance = await actor("finance", false);
  const denied = { code: "42501" };

  await expect(as(null, () => associations(item))).rejects.toMatchObject(denied);
  for (const user of [buyer, warehouse, unverifiedFinance]) expect(await as(user, () => associations(item))).toEqual([]);
  for (const user of [catalogue, finance]) {
    expect(await as(user, () => associations(item))).toHaveLength(1);
    await expect(as(user, () => db.query("delete from public.staff_variant_suppliers where variant_id = $1", [item])))
      .rejects.toMatchObject(denied);
  }
  for (const user of [null, buyer]) {
    expect(await as(user, async () => (await db.query("select id from public.variants where id = $1", [item])).rows))
      .toEqual([{ id: item }]);
    for (const column of ["supplier_name", "supplier_part_number"]) {
      await expect(as(user, () => db.query(`select ${column} from public.variants where id = $1`, [item])))
        .rejects.toMatchObject(denied);
    }
    await expect(as(user, () => remember(randomUUID(), item, 1, null))).rejects.toMatchObject(denied);
  }
});

test("explicit remember uses the saved line, rejects stale writes, and never replaces the usual supplier or unpublishes", async () => {
  const finance = await actor("finance");
  const item = await variant("Unmatched legacy source", "OLD-PART", true);
  const first = await supplier();
  const second = await supplier();
  const catalogueVersion = async () => (await db.query<{ version: string }>(
    "select catalogue_updated_at::text as version from public.variants where id = $1", [item],
  )).rows[0]!.version;
  const before = await catalogueVersion();
  const po = await as(finance, () => savePo(item, first, null));
  const alternate = await as(finance, () => savePo(item, second, "ALT-PART"));
  expect(await associations(item)).toEqual([]);
  await expect(as(finance, () => remember(po, randomUUID(), 1, null)))
    .rejects.toMatchObject({ message: "staff_purchase_supplier_line_required" });
  expect(await as(finance, () => remember(po, item, 1, null))).toBe(true);
  const [usual] = await associations(item);
  expect(usual).toMatchObject({ supplier_id: first, supplier_part_number: null, is_usual: true });
  expect(await catalogueVersion()).not.toBe(before);

  await as(finance, () => savePo(item, first, "FIRST-PART", po, 1));
  await expect(as(finance, () => remember(po, item, 1, usual!.updated_at)))
    .rejects.toMatchObject({ code: "40001", message: "staff_purchase_order_revision_conflict" });
  await expect(as(finance, () => remember(po, item, 2, null)))
    .rejects.toMatchObject({ code: "40001", message: "staff_variant_supplier_conflict" });
  expect(await as(finance, () => remember(po, item, 2, usual!.updated_at))).toBe(true);
  expect(await as(finance, () => remember(alternate, item, 1, null))).toBe(true);
  expect(await associations(item)).toEqual([
    { supplier_id: first, supplier_part_number: "FIRST-PART", is_usual: true, updated_at: expect.any(String) },
    { supplier_id: second, supplier_part_number: "ALT-PART", is_usual: false, updated_at: expect.any(String) },
  ]);
  expect((await db.query(`
    select publication_status, evidence_source, supplier_name, supplier_part_number from public.variants where id = $1
  `, [item])).rows).toEqual([{
    publication_status: "published", evidence_source: "Fit test", supplier_name: "Unmatched legacy source", supplier_part_number: "OLD-PART",
  }]);
});
