import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { setDbClaims } from "../helpers/db-claims";

type Variant = { id: string; sku: string; updated_at: string };
type Mapping = { id: string; code: string; updated_at: string };
type StaffRole = "catalogue" | "warehouse" | "finance";

let db: Client;
let connectionString: string;
let actor: string;
let family: { id: string; slug: string };
let variant: Variant;
let mapping: Mapping;
let alias: Mapping;
let users: string[];

async function connect(role?: "service_role" | "anon" | "authenticated") {
  const client = new Client({ connectionString, connectionTimeoutMillis: 3000, statement_timeout: 8000 });
  await client.connect();
  if (role) await client.query(`set role ${role}`);
  return client;
}

async function staff(role?: StaffRole) {
  const id = randomUUID();
  users.push(id);
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id}@example.test`]);
  if (role) await db.query("insert into public.staff_members (user_id, role) values ($1, $2)", [id, role]);
  return id;
}

async function createVariant(optionLabel = "45°"): Promise<Variant> {
  const { rows: [row] } = await db.query<Variant>(`
    insert into public.variants (
      product_id, sku, option_label, tool, angle_deg, supplier_name, supplier_part_number,
      price_1_4_pence, price_5_9_pence, price_10_plus_pence
    ) values ($1, $2, $3, 'UCT', 45, 'DB test supplier', 'PART-45', 1200, 1000, 900)
    returning id, sku, catalogue_updated_at::text as updated_at
  `, [family.id, `CATSKU-${randomUUID()}`, optionLabel]);
  await db.query("insert into public.variant_substrates values ($1, 'vinyl')", [row!.id]);
  return row!;
}

async function createMapping(id: string, kind: "item_number" | "alias"): Promise<Mapping> {
  const { rows: [row] } = await db.query<Mapping>(`
    insert into public.compatibility (variant_id, code, code_kind, brand) values ($1, $2, $3, 'zund')
    returning id, code, updated_at::text
  `, [id, `900-${randomUUID().replace(/\D/g, "")}`, kind]);
  return row!;
}

beforeAll(async () => {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("These tests need the local Supabase stack. Run pnpm db:start && pnpm db:env.");
  }
  connectionString = url;
  db = await connect();
});

beforeEach(async () => {
  users = [];
  actor = await staff("catalogue");
  const slug = `admin-catalogue-test-${randomUUID()}`;
  const { rows: [row] } = await db.query<{ id: string; slug: string }>(`
    insert into public.products (family_code, slug, name, tool_category, description)
    values ($1, $1, 'DB test family', 'drag', 'Variant publication test.') returning id, slug
  `, [slug]);
  family = row!;
  variant = await createVariant();
  mapping = await createMapping(variant.id, "item_number");
  alias = await createMapping(variant.id, "alias");
});

afterEach(async () => {
  await db.query("delete from private.variant_price_changes where variant_id in (select id from public.variants where product_id = $1)", [family.id]);
  await db.query("delete from public.variants where product_id = $1", [family.id]);
  await db.query("delete from public.products where id = $1", [family.id]);
  await db.query("delete from auth.users where id = any($1::uuid[])", [users]);
});

afterAll(() => db?.end());

async function version(table: "products" | "variants" | "compatibility", id: string) {
  const column = table === "variants" ? "catalogue_updated_at" : "updated_at";
  const { rows: [row] } = await db.query<{ version: string }>(`select ${column}::text as version from public.${table} where id = $1`, [id]);
  return row!.version;
}

function selling(overrides: Record<string, unknown> = {}) {
  return {
    name: "DB test family", description: "Variant publication test.", tool_category: "drag",
    supplier_name: "DB test supplier", supplier_part_number: "PART-45", option_label: "45°",
    tool: "UCT", angle_deg: 45, specs: {}, substrates: ["vinyl"],
    price_1_4_pence: 1200, price_5_9_pence: 1000, price_10_plus_pence: 900, ...overrides,
  };
}

test("successful tier changes record both sets of prices and the catalogue actor once", async () => {
  const service = await connect("service_role");
  try {
    await save(service, { price_1_4_pence: 1325 });
    await save(service, { price_1_4_pence: 1325 });
    await expect(save(service, { price_1_4_pence: 825 })).rejects.toMatchObject({ message: "catalogue_invalid_selling_data" });
    const { rows } = await db.query(`
      select actor_id, old_tiers_pence, new_tiers_pence, recorded_at
      from private.variant_price_changes where variant_id = $1 order by id
    `, [variant.id]);
    expect(rows).toEqual([
      { actor_id: null, old_tiers_pence: null, new_tiers_pence: [1200, 1000, 900], recorded_at: expect.any(Date) },
      { actor_id: actor, old_tiers_pence: [1200, 1000, 900], new_tiers_pence: [1325, 1000, 900], recorded_at: expect.any(Date) },
    ]);
    await expect(service.query("select * from private.variant_price_changes")).rejects.toMatchObject({ code: "42501" });
  } finally {
    await service.end();
  }
});

async function save(client: Client, patch: Record<string, unknown>, variantVersion?: string) {
  return client.query("select public.admin_catalogue_update($1, $2, $3, $4, $5)", [
    actor, variant.id, variantVersion ?? await version("variants", variant.id),
    await version("products", family.id), selling(patch),
  ]);
}

async function review(client: Client, options: {
  variant?: Variant; record?: Mapping; approve?: boolean; source?: string; note?: string;
  actor?: string | null; variantVersion?: string; mappingVersion?: string; brand?: string | null;
} = {}) {
  const item = options.variant ?? variant;
  const record = options.record;
  return client.query("select public.admin_catalogue_review($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
    options.actor === undefined ? actor : options.actor, item.id,
    options.variantVersion ?? await version("variants", item.id), options.approve ?? true,
    options.source ?? "DB test supplier fit report 45A", options.note ?? "Matched the sample blade against the original holder.",
    record?.id ?? null, record ? (options.mappingVersion ?? await version("compatibility", record.id)) : null,
    record ? "https://example.test/fit-report" : null, options.brand === undefined ? "zund" : options.brand,
    record ? "DBT-fit-machine" : null,
  ]);
}

async function publish(client: Client, value = true, item = variant, expected?: string) {
  return client.query("select public.admin_catalogue_set_publication($1, $2, $3, $4) as slug", [
    actor, item.id, expected ?? await version("variants", item.id), value,
  ]);
}

async function visible(client: Client, query: string) {
  return (await client.query<{ variant_id: string }>("select variant_id from public.search_blades($1)", [query])).rows
    .some(({ variant_id }) => variant_id === variant.id);
}

test("only fully verified catalogue staff can archive a current variant version", async () => {
  const service = await connect("service_role");
  const anon = await connect("anon");
  const session = await connect();
  async function archive(id: string | null, steppedUp: boolean, version: string) {
    const role = id ? "authenticated" : "anon";
    await session.query("begin");
    try {
      await setDbClaims(session, role, id, steppedUp);
      await session.query(`set local role ${role}`);
      const result = await session.query("select public.archive_staff_variant($1, $2) as slug", [variant.id, version]);
      await session.query("commit");
      return result.rows;
    } catch (error) {
      await session.query("rollback");
      throw error;
    }
  }
  try {
    await review(service);
    await review(service, { record: mapping });
    await publish(service);
    expect(await visible(anon, mapping.code)).toBe(true);
    const current = await version("variants", variant.id);
    await expect(archive(null, false, current)).rejects.toMatchObject({ code: "42501" });
    await expect(archive(await staff("warehouse"), true, current)).rejects.toMatchObject({ code: "42501" });
    await expect(archive(await staff("finance"), true, current)).rejects.toMatchObject({ code: "42501" });
    await expect(archive(actor, false, current)).rejects.toMatchObject({ code: "42501" });
    await expect(archive(actor, true, variant.updated_at)).rejects.toMatchObject({ message: "catalogue_stale" });
    await expect(archive(actor, true, current)).resolves.toEqual([{ slug: family.slug }]);
    const retired = await version("variants", variant.id);
    await expect(archive(actor, true, retired)).resolves.toEqual([{ slug: family.slug }]);
    expect(await version("variants", variant.id)).toEqual(retired);
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_invalid_publication" });
    expect(await visible(anon, mapping.code)).toBe(false);
    expect((await anon.query("select id from public.variants where id = $1", [variant.id])).rows).toEqual([]);
  } finally {
    await Promise.all([anon.end(), service.end(), session.end()]);
  }
});

test("staff can save an unpriced draft and cannot publish until all tiers are set", async () => {
  const service = await connect("service_role");
  try {
    const blank = { price_1_4_pence: null, price_5_9_pence: null, price_10_plus_pence: null };
    await expect(save(service, { ...blank, price_1_4_pence: 1200 }))
      .rejects.toMatchObject({ message: "catalogue_invalid_selling_data" });
    await save(service, { ...blank, supplier_part_number: "UNPRICED-DRAFT" });
    const { rows: [draft] } = await db.query(`
      select publication_status, supplier_part_number, price_1_4_pence, price_5_9_pence, price_10_plus_pence
      from public.variants where id = $1
    `, [variant.id]);
    expect(draft).toEqual({ ...blank, publication_status: "draft", supplier_part_number: "UNPRICED-DRAFT" });
    await review(service);
    await review(service, { record: mapping });
    await expect(publish(service)).rejects.toMatchObject({ constraint: "variants_prices_required_outside_draft" });
    await save(service, { supplier_part_number: "UNPRICED-DRAFT" });
    await publish(service);
    await expect(save(service, { ...blank, supplier_part_number: "UNPRICED-DRAFT" }))
      .rejects.toMatchObject({ message: "catalogue_invalid_selling_data" });
  } finally {
    await service.end();
  }
});

test("only service_role can execute the RPCs, and each checks explicit catalogue membership", async () => {
  const { rows } = await db.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname like 'admin_catalogue_%')
      or (n.nspname = 'private' and p.proname in ('keep_catalogue_mapping_private', 'lock_admin_catalogue_variant',
        'catalogue_has_public_fit', 'catalogue_trim', 'touch_catalogue_version'))
    order by p.proname
  `);
  expect(rows.map(({ proname, anon, authenticated, service }) => [proname, anon, authenticated, service])).toEqual([
    ["admin_catalogue_review", false, false, true],
    ["admin_catalogue_set_publication", false, false, true],
    ["admin_catalogue_update", false, false, true],
    ["catalogue_has_public_fit", false, false, false],
    ["catalogue_trim", false, false, false],
    ["keep_catalogue_mapping_private", false, false, false],
    ["lock_admin_catalogue_variant", false, false, false],
    ["touch_catalogue_version", false, false, false],
  ]);

  const service = await connect("service_role");
  const authenticated = await connect("authenticated");
  try {
    await authenticated.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
    await expect(review(authenticated)).rejects.toMatchObject({ code: "42501" });
    await expect(service.query("update public.variants set publication_status = 'draft' where id = $1", [variant.id]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(service.query("update public.compatibility set verification_state = 'approved' where id = $1", [mapping.id]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(service.query("delete from public.variant_substrates where variant_id = $1", [variant.id]))
      .rejects.toMatchObject({ code: "42501" });
    const warehouse = await staff("warehouse");
    const buyer = await staff();
    for (const unauthorized of [warehouse, buyer, null]) {
      await expect(review(service, { actor: unauthorized })).rejects.toMatchObject({ message: "catalogue_role_required" });
      await expect(service.query("select public.admin_catalogue_update($1, $2, $3, $4, $5)", [
        unauthorized, variant.id, variant.updated_at, await version("products", family.id), selling(),
      ])).rejects.toMatchObject({ message: "catalogue_role_required" });
      await expect(service.query("select public.admin_catalogue_set_publication($1, $2, $3, true)", [
        unauthorized, variant.id, variant.updated_at,
      ])).rejects.toMatchObject({ message: "catalogue_role_required" });
    }
    await expect(review(service)).resolves.toMatchObject({ rowCount: 1 });
  } finally {
    await Promise.all([service.end(), authenticated.end()]);
  }
});

test("validates evidence and keeps both candidate and approved aliases out of public reads", async () => {
  const service = await connect("service_role");
  const anon = await connect("anon");
  const authenticated = await connect("authenticated");
  try {
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_variant_not_approved" });
    await expect(review(service, { source: "\n\t " })).rejects.toMatchObject({ message: "catalogue_review_evidence_required" });
    await expect(review(service, { source: "PRD Appendix A working list (unverified)" })).rejects.toMatchObject({ message: "catalogue_review_evidence_required" });
    await expect(review(service, { record: mapping, note: "" })).rejects.toMatchObject({ message: "catalogue_review_evidence_required" });
    await expect(review(service, { record: mapping, brand: null })).rejects.toMatchObject({ message: "catalogue_mapping_brand_required" });
    await review(service);
    expect(await visible(anon, variant.sku)).toBe(false);
    await review(service, { record: alias, brand: null });
    const { rows: privateRows } = await db.query("select is_private, verification_state, approved_by from public.compatibility where id = $1", [alias.id]);
    expect(privateRows).toEqual([{ is_private: true, verification_state: "approved", approved_by: actor }]);
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_verified_fit_required" });
    await review(service, { record: mapping });
    expect((await publish(service)).rows).toEqual([{ slug: family.slug }]);
    expect(await visible(anon, variant.sku)).toBe(true);
    expect(await visible(anon, mapping.code)).toBe(true);
    const pending = await createMapping(variant.id, "alias");
    await db.query("update public.compatibility set is_private = false where id = $1", [pending.id]);
    expect((await db.query("select is_private from public.compatibility where id = $1", [pending.id])).rows)
      .toEqual([{ is_private: true }]);
    for (const publicUser of [anon, authenticated]) {
      expect(await visible(publicUser, alias.code)).toBe(false);
      expect(await visible(publicUser, pending.code)).toBe(false);
      expect((await publicUser.query("select code from public.compatibility where variant_id = $1", [variant.id])).rows)
        .toEqual([{ code: mapping.code }]);
      await expect(publicUser.query("select evidence_note from public.compatibility")).rejects.toMatchObject({ code: "42501" });
    }

    await review(service, { approve: false, record: alias });
    expect(await visible(anon, mapping.code)).toBe(true);
    await review(service, { approve: false, record: mapping });
    expect(await visible(anon, mapping.code)).toBe(false);
    expect(await visible(anon, variant.sku)).toBe(false);
    expect((await db.query("select verification_state, rejected_by, evidence_note from public.compatibility where id = $1", [mapping.id])).rows)
      .toEqual([{ verification_state: "rejected", rejected_by: actor, evidence_note: "Matched the sample blade against the original holder." }]);
  } finally {
    await Promise.all([service.end(), anon.end(), authenticated.end()]);
  }
});

test("keeps intentionally public approved aliases public without exposing private candidates", async () => {
  const service = await connect("service_role");
  const anon = await connect("anon");
  try {
    const { rows: [publicAlias] } = await db.query<Mapping>(`
      insert into public.compatibility (variant_id, code, code_kind, brand, verification_state, approved_at, evidence_source)
      values ($1, $2, 'alias', 'zund', 'approved', now(), 'DB test supplier')
      returning id, code, updated_at::text
    `, [variant.id, `800-${randomUUID().replace(/\D/g, "")}`]);
    await review(service);
    await review(service, { record: publicAlias! });
    await publish(service);
    expect(await visible(anon, publicAlias!.code)).toBe(true);
    expect(await visible(anon, alias.code)).toBe(false);
  } finally {
    await Promise.all([service.end(), anon.end()]);
  }
});

test("validates the variant, allows unpublication without stock, and records rejection", async () => {
  const service = await connect("service_role");
  const anon = await connect("anon");
  try {
    await save(service, { supplier_part_number: "\t ", substrates: [] });
    await review(service);
    await review(service, { record: mapping });
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_incomplete_selling_data" });
    await save(service, {});
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_variant_not_approved" });
    await review(service);
    await review(service, { record: mapping });
    await publish(service);
    expect((await anon.query("select availability from public.variants where id = $1", [variant.id])).rows)
      .toEqual([{ availability: "out_of_stock" }]);
    await publish(service, false);
    expect(await visible(anon, variant.sku)).toBe(false);
    expect((await db.query("select approved_by from public.variants where id = $1", [variant.id])).rows).toEqual([{ approved_by: actor }]);
    await publish(service);
    await review(service, { approve: false, note: "Wrong holder on the test blade." });
    expect(await visible(anon, variant.sku)).toBe(false);
    expect((await db.query("select publication_status, approved_at, rejected_by, evidence_note from public.variants where id = $1", [variant.id])).rows)
      .toEqual([{ publication_status: "draft", approved_at: null, rejected_by: actor, evidence_note: "Wrong holder on the test blade." }]);
  } finally {
    await Promise.all([service.end(), anon.end()]);
  }
});

test("edits family and variant selling data atomically without rewriting identities or stock", async () => {
  const service = await connect("service_role");
  try {
    await review(service);
    await review(service, { record: mapping });
    await publish(service);
    await expect(save(service, { name: "Invalid new name", price_5_9_pence: 1201 })).rejects.toMatchObject({ message: "catalogue_invalid_selling_data" });
    await expect(save(service, { name: "Invalid new name", substrates: ["no-such-substrate"] })).rejects.toMatchObject({ code: "23503" });
    expect((await db.query("select name from public.products where id = $1", [family.id])).rows).toEqual([{ name: "DB test family" }]);
    await save(service, { name: "Updated blade family", price_1_4_pence: 1400 });
    const { rows: [live] } = await db.query("select publication_status, price_1_4_pence, approved_by from public.variants where id = $1", [variant.id]);
    expect(live).toEqual({ publication_status: "published", price_1_4_pence: 1400, approved_by: actor });
    await save(service, { name: "Updated blade family", supplier_part_number: "PART-45-REV", substrates: ["foamex"],
      specs: { "Verified profile": "Flat" }, price_1_4_pence: 1400, sku: "NOT-EDITABLE", stock_on_hand: 99 });
    const { rows: [updated] } = await db.query(`
      select v.sku, v.stock_on_hand, v.publication_status, v.approved_at, v.supplier_part_number, v.specs,
        p.slug, p.name, array(select substrate from public.variant_substrates where variant_id = v.id) as substrates
      from public.variants v join public.products p on p.id = v.product_id where v.id = $1
    `, [variant.id]);
    expect(updated).toEqual({ sku: variant.sku, stock_on_hand: 0, publication_status: "draft", approved_at: null,
      supplier_part_number: "PART-45-REV", specs: { "Verified profile": "Flat" }, slug: family.slug, name: "Updated blade family",
      substrates: ["foamex"] });
    expect((await db.query("select verification_state, approved_at from public.compatibility where id = $1", [mapping.id])).rows)
      .toEqual([{ verification_state: "candidate", approved_at: null }]);
  } finally {
    await service.end();
  }
});

test("saves the usual supplier atomically, preserving fit checks and other suppliers’ part numbers", async () => {
  const service = await connect("service_role");
  const suppliers = [randomUUID(), randomUUID()];
  try {
    await db.query("insert into public.staff_suppliers (id, name) select id, id::text from unnest($1::uuid[]) as id", [suppliers]);
    const link = { usual_supplier_id: suppliers[0], usual_supplier_part_number: "REGISTERED-PART" };
    const links = async () => (await db.query(`
      select supplier_id, supplier_part_number, is_usual from public.staff_variant_suppliers
      where variant_id = $1 order by is_usual desc
    `, [variant.id])).rows;
    await expect(save(service, { ...link, substrates: ["no-such-substrate"] })).rejects.toMatchObject({ code: "23503" });
    await expect(save(service, { ...link, usual_supplier_part_number: "P".repeat(121) }))
      .rejects.toMatchObject({ code: "22023", message: "catalogue_invalid_selling_data" });
    expect(await links()).toEqual([]);
    const oldVersion = await version("variants", variant.id);
    await save(service, { ...link, supplier_name: null, supplier_part_number: null, price_1_4_pence: 1250 }, oldVersion);
    await expect(save(service, { usual_supplier_id: suppliers[1] }, oldVersion)).rejects.toMatchObject({ message: "catalogue_stale" });
    await review(service);
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_verified_fit_required" });
    await review(service, { record: mapping });
    await publish(service);
    await save(service, { usual_supplier_id: suppliers[1], supplier_name: null, supplier_part_number: null, price_1_4_pence: 1250 });

    expect(await links()).toEqual([
      { supplier_id: suppliers[1], supplier_part_number: null, is_usual: true },
      { supplier_id: suppliers[0], supplier_part_number: "REGISTERED-PART", is_usual: false },
    ]);
    expect((await db.query("select publication_status, approved_at from public.variants where id = $1", [variant.id])).rows)
      .toEqual([{ publication_status: "draft", approved_at: null }]);
    expect((await db.query("select verification_state from public.compatibility where id = $1", [mapping.id])).rows)
      .toEqual([{ verification_state: "candidate" }]);
    await review(service);
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_incomplete_selling_data" });
  } finally {
    await service.end();
    await db.query("delete from public.staff_variant_suppliers where supplier_id = any($1::uuid[])", [suppliers]);
    await db.query("delete from public.staff_suppliers where id = any($1::uuid[])", [suppliers]);
  }
});

test("rejects a mapping associated with a different variant and stale mapping reviews", async () => {
  const service = await connect("service_role");
  try {
    const sibling = await createVariant("60°");
    await expect(review(service, { variant: sibling, record: mapping })).rejects.toMatchObject({ message: "catalogue_mapping_not_found" });
    await review(service, { record: mapping });
    await expect(review(service, { record: mapping, mappingVersion: mapping.updated_at, approve: false }))
      .rejects.toMatchObject({ message: "catalogue_stale" });
  } finally {
    await service.end();
  }
});

test("changing the blade geometry requires reapproval of its existing fit evidence", async () => {
  const service = await connect("service_role");
  try {
    await review(service);
    await review(service, { record: mapping });
    await publish(service);
    await save(service, { angle_deg: 55 });
    await review(service);
    await expect(publish(service)).rejects.toMatchObject({ message: "catalogue_verified_fit_required" });
    await review(service, { record: mapping });
    await publish(service);
  } finally {
    await service.end();
  }
});

test("stock activity does not invalidate an open catalogue form", async () => {
  const service = await connect("service_role");
  try {
    const expected = await version("variants", variant.id);
    await db.query("update public.variants set stock_on_hand = 5 where id = $1", [variant.id]);
    expect(await version("variants", variant.id)).toBe(expected);
    await save(service, { price_1_4_pence: 1400 }, expected);
    expect(await version("variants", variant.id)).not.toBe(expected);
  } finally {
    await service.end();
  }
});

async function backendPid(client: Client) {
  const { rows: [row] } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  return row!.pid;
}

async function blockedBy(waitingPid: number, holdingPid: number) {
  for (let i = 0; i < 100; ++i) {
    const { rows: [row] } = await db.query<{ blocked: boolean }>("select $2 = any(pg_blocking_pids($1)) as blocked", [waitingPid, holdingPid]);
    if (row?.blocked) return;
    await delay(25);
  }
  throw new Error("The second connection did not wait for the first.");
}

test("a concurrent reviewer cannot approve selling data that changed while waiting for the variant lock", async () => {
  const [first, second] = await Promise.all([connect("service_role"), connect("service_role")]);
  try {
    const [holding, waiting] = await Promise.all([backendPid(first), backendPid(second)]);
    await first.query("begin");
    await save(first, { tool: "Different holder" }, variant.updated_at);
    const approval = review(second, { variantVersion: variant.updated_at }).then(() => null, (error: unknown) => error);
    await blockedBy(waiting, holding);
    await first.query("commit");
    expect(await approval).toMatchObject({ message: "catalogue_stale" });
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
});

test("concurrent sibling publication cannot produce duplicate labels", async () => {
  const [first, second] = await Promise.all([connect("service_role"), connect("service_role")]);
  try {
    const [holding, waiting] = await Promise.all([backendPid(first), backendPid(second)]);
    const sibling = await createVariant();
    await review(first);
    await review(first, { record: mapping });
    await review(first, { variant: sibling, record: await createMapping(sibling.id, "item_number") });
    await review(first, { variant: sibling });
    await first.query("begin");
    await publish(first);
    const conflict = publish(second, true, sibling).then(() => null, (error: unknown) => error);
    await blockedBy(waiting, holding);
    await first.query("commit");
    expect(await conflict).toMatchObject({ message: "catalogue_incomplete_selling_data" });
    expect((await db.query("select sku from public.variants where product_id = $1 and publication_status = 'published'", [family.id])).rows)
      .toEqual([{ sku: variant.sku }]);
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
});
