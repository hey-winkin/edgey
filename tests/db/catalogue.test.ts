import { afterAll, beforeAll, expect, test } from "vitest";
import { Client } from "pg";
import manifest from "../../docs/artwork-sources.json";

let db: Client;

beforeAll(async () => {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString || !["127.0.0.1", "localhost"].includes(new URL(connectionString).hostname)) {
    throw new Error("These tests need the local Supabase stack. Run pnpm db:start && pnpm db:env && pnpm db:fixture.");
  }
  db = new Client({ connectionString });
  await db.connect();
  await db.query("set role anon");
});

afterAll(() => db?.end());

type Hit = { sku: string; match_type: string; matched_code: string | null; requires_choice: boolean };
const search = async (query: string) =>
  (await db.query<Hit>("select * from public.search_blades($1)", [query])).rows;

test.each([
  ["  eDg - z10 ", "EDG-Z10"],
  [" 3910.301 ", "3910301"],
  [" 391 360 ", "391-360"],
])("matches %j exactly and preserves the printed code", async (query, code) => {
  expect(await search(query)).toEqual([
    expect.objectContaining({ match_type: "exact", matched_code: code, requires_choice: false }),
  ]);
});

test("every exact configuration is returned and requires a choice", async () => {
  const hits = await search("SPB 0030");
  expect(hits.map(({ sku }) => sku)).toEqual(["EDG-MIM-A45", "EDG-MIM-A60"]);
  for (const hit of hits) expect(hit).toMatchObject({ match_type: "exact", requires_choice: true });
});

test("labels substrate and typo-tolerant brand/tool suggestions", async () => {
  const materials = await search("Foamex");
  expect(materials.slice(0, 2).map(({ sku }) => sku)).toEqual(["EDG-Z10", "EDG-SR6223"]);
  expect(materials.every(({ match_type }) => match_type === "suggested")).toBe(true);
  expect(await search("Zund oscilating")).toEqual([
    expect.objectContaining({ sku: "EDG-Z16", match_type: "suggested" }),
  ]);
});

test.each(["", "00000000", "5201345", "5006045", "500-9802", "500-9807", "SF427", "BLD-DF113", "BLD-SF216",
  "PRIV-Z10-ALIAS", "EDG-Z11", "EDG-MIM-A30", "CB09U", "CB09UB"])(
  "excludes unknown, corrected, private, unverified and draft codes (%j)",
  async (query) => {
    expect(await search(query)).toEqual([]);
  },
);

test("the fixture approves the updated Z71 item without admitting the Z60 packet code", async () => {
  expect(await search("3910334")).toEqual([expect.objectContaining({ sku: "EDG-Z71", match_type: "exact" })]);
});

test("RLS excludes drafts and candidates even inside a visible family", async () => {
  const { rows: variants } = await db.query("select sku from public.variants order by sku");
  expect(variants.map(({ sku }) => sku)).toContain("EDG-MIM-A45");
  expect(variants.map(({ sku }) => sku)).not.toContain("EDG-MIM-A30");
  expect(variants.map(({ sku }) => sku)).not.toContain("EDG-Z11");

  const { rows: compatibility } = await db.query("select code, verification_state, is_private from public.compatibility");
  expect(compatibility).toContainEqual({ code: "3910301", verification_state: "approved", is_private: false });
  expect(compatibility.every(({ verification_state, is_private }) => verification_state === "approved" && !is_private)).toBe(true);
  expect(compatibility.map(({ code }) => code)).not.toContain("500-9802");
  expect(compatibility.map(({ code }) => code)).not.toContain("PRIV-Z10-ALIAS");

  const { rows: brands } = await db.query("select slug from public.brands");
  expect(brands.map(({ slug }) => slug)).not.toContain("graphtec");
});

test("column grants keep stock counts and supplier identifiers private", async () => {
  await expect(db.query("select supplier_part_number from public.variants")).rejects.toMatchObject({ code: "42501" });
  await expect(db.query("select stock_on_hand from public.variants")).rejects.toMatchObject({ code: "42501" });
});

test("public machine lookup data excludes private and unapproved compatibility rows on published variants", async () => {
  await db.query("reset role");
  await db.query("begin");
  try {
    const fixture = await db.query(`
      update public.compatibility c set machine = 'Local test model ' || c.code
      from public.variants v
      where c.variant_id = v.id and v.publication_status = 'published'
        and ((v.sku = 'EDG-Z10' and c.code = 'PRIV-Z10-ALIAS' and c.is_private)
          or (v.sku = 'EDG-MIM-A45' and c.code = 'MD300V' and c.verification_state = 'candidate'))
    `);
    expect(fixture.rowCount).toBe(2);
    await db.query("set local role anon");
    const { rows } = await db.query("select machine from public.compatibility where machine like 'Local test model %'");
    expect(rows).toEqual([]);
  } finally {
    await db.query("rollback");
    await db.query("set role anon");
  }
});

test("the import has exactly one SKU per order line and the three retained drafts", async () => {
  await db.query("reset role");
  try {
    const { rows } = await db.query(`
      select
        (select count(*)::int from public.products where family_code like 'EDG-%') as families,
        (select count(*)::int from public.products where family_code like 'EDG-%' and name ~ '^[A-Z]'
         and description ~ '^[A-Z].+[.]$' and name <> family_code) as families_with_plain_copy,
        (select count(*)::int from public.variants where sku like 'EDG-%' and publication_status = 'draft') as drafts,
        (select bool_and(stock_on_hand = 0 and stock_reserved = 0) from public.variants
         where sku like 'EDG-%' and publication_status = 'draft') as draft_stock_is_zero
    `);
    expect(rows).toEqual([{ families: 26, families_with_plain_copy: 26, drafts: 24, draft_stock_is_zero: true }]);
    const { rows: variants } = await db.query(`
      select sku, price_1_4_pence, price_5_9_pence, price_10_plus_pence, specs,
        v.evidence_source, v.approved_at, v.publication_status, v.stock_on_hand
      from public.variants v join public.products p on p.id = v.product_id
      where sku like 'EDG-%' order by sku
    `);
    expect(variants.map(({ sku }) => sku)).toEqual([
      "EDG-DF113", "EDG-GRP-CB09-45", "EDG-GRP-CB09-60", "EDG-GRP-CB15-45", "EDG-GRP-CB15-60",
      "EDG-HTR040", "EDG-MIM-A30", "EDG-MIM-A45", "EDG-MIM-A60", "EDG-ROL-A30", "EDG-ROL-A45", "EDG-ROL-A60",
      "EDG-SR6223", "EDG-SR6224", "EDG-SR6310", "EDG-SR6315", "EDG-SUM-9802", "EDG-SUM-9803",
      "EDG-SUM-DRG-36", "EDG-SUM-DRG-60", "EDG-SUM-TAN-36", "EDG-SUM-TAN-45",
      "EDG-Z1", "EDG-Z10", "EDG-Z11", "EDG-Z16", "EDG-Z17", "EDG-Z2", "EDG-Z20",
      "EDG-Z21", "EDG-Z28", "EDG-Z46", "EDG-Z50", "EDG-Z52", "EDG-Z71",
    ]);
    for (const row of variants.filter(({ sku }) => sku.startsWith("EDG-GRP-"))) {
      expect(row).toMatchObject({ price_1_4_pence: 1195, price_5_9_pence: 900, price_10_plus_pence: 750 });
    }
    const unordered = variants.filter(({ sku }) => ["EDG-HTR040", "EDG-MIM-A30", "EDG-ROL-A30"].includes(sku));
    for (const row of unordered) expect(row).toMatchObject({
      specs: {}, publication_status: "draft", stock_on_hand: 0, approved_at: null, evidence_source: null,
    });
    expect(variants.filter(({ sku, publication_status }) =>
      publication_status === "draft" && !unordered.some((row) => row.sku === sku),
    ).every(({ evidence_source }) => evidence_source === "Owner-supplied specifications (2026-11-21; unverified)")).toBe(true);
    const { rows: mapped } = await db.query(`
      select v.sku, c.code from public.variants v
      join public.compatibility c on c.variant_id = v.id
      where c.code in ('5201345', '5006045', '42442525', '42443366', '3910105', '4800073',
        'G42438135', 'G42449504', '3910110', '3910115', '3910328', '3910334')
      order by v.sku
    `);
    expect(mapped).toEqual([
      { sku: "EDG-SR6224", code: "G42438135" },
      { sku: "EDG-SR6315", code: "G42449504" },
      { sku: "EDG-Z1", code: "3910110" },
      { sku: "EDG-Z2", code: "3910115" },
      { sku: "EDG-Z46", code: "3910328" },
      { sku: "EDG-Z71", code: "3910334" },
    ]);
  } finally {
    await db.query("set role anon");
  }
});

test("the three accepted tier sets are seeded in pence without approving or publishing the variants", async () => {
  await db.query("reset role");
  try {
    const { rows } = await db.query(`
      select v.sku, v.price_1_4_pence, v.price_5_9_pence, v.price_10_plus_pence, p.media,
        v.evidence_source, v.approved_at, v.publication_status, v.stock_on_hand
      from public.variants v join public.products p on p.id = v.product_id
      where v.sku in ('EDG-DF113', 'EDG-SUM-9802', 'EDG-SUM-9803') order by v.sku
    `);
    expect(rows).toEqual([
      ["EDG-DF113", 2150, 1895, 1650],
      ["EDG-SUM-9802", 2095, 1850, 1595],
      ["EDG-SUM-9803", 2095, 1850, 1595],
    ].map(([sku, price_1_4_pence, price_5_9_pence, price_10_plus_pence]) => ({
      sku, price_1_4_pence, price_5_9_pence, price_10_plus_pence,
      media: expect.objectContaining({
        drawing: (manifest as { sku: string; drawing: string }[]).find((entry) => entry.sku === sku)?.drawing,
      }),
      publication_status: "draft", stock_on_hand: 0, approved_at: null,
      evidence_source: "Owner-supplied specifications (2026-11-21; unverified)",
    })));
  } finally {
    await db.query("set role anon");
  }
});

test("length and depth distinguish the flat drag blades and do not transfer the Z11 code to DF113", async () => {
  await db.query("reset role");
  try {
    const { rows } = await db.query(`
      select v.sku, v.specs->>'Length' as length, v.cutting_depth_mm::text as depth, v.evidence_note,
        array_agg(c.code order by c.code) as codes
      from public.variants v join public.compatibility c on c.variant_id = v.id
      where v.sku in ('EDG-Z10', 'EDG-Z11', 'EDG-SUM-9802', 'EDG-SUM-9803', 'EDG-DF113')
        and not c.is_private
      group by v.id order by v.sku
    `);
    expect(rows).toEqual([
      { sku: "EDG-DF113", length: "50 mm", depth: "6.50", codes: ["BLD-DF113", "G42443036"],
        evidence_note: expect.stringContaining("Stated equivalent to Z11") },
      { sku: "EDG-SUM-9802", length: "25 mm", depth: "4.80", codes: ["500-9802", "BLD-DF112"], evidence_note: null },
      { sku: "EDG-SUM-9803", length: "25 mm", depth: "6.50", codes: ["500-9803"], evidence_note: null },
      { sku: "EDG-Z10", length: "50 mm", depth: "4.80", codes: ["3910301", "Z10"], evidence_note: null },
      { sku: "EDG-Z11", length: "50 mm", depth: "6.90", codes: ["3910309", "Z11"], evidence_note: null },
    ]);
  } finally {
    await db.query("set role anon");
  }
});

test("approved cross-references find the right physical SKUs, and shared holder codes require a choice", async () => {
  await db.query("reset role");
  await db.query("begin");
  try {
    const approvedCodes = ["500-9807", "SF427", "CB09U", "CB15U"];
    const { rows } = await db.query(`
      update public.compatibility c set verification_state = 'approved', approved_at = now()
      from public.variants v where v.id = c.variant_id and c.code = any($1)
        and c.verification_state = 'candidate' and not c.is_private and c.evidence_source like 'Owner-supplied%'
      returning v.sku
    `, [approvedCodes]);
    expect(rows).toHaveLength(6);
    await db.query(`
      update public.variants set publication_status = 'published', approved_at = now(), supplier_part_number = 'TEST'
      where sku = any($1)
    `, [rows.map(({ sku }) => sku)]);
    await db.query("set local role anon");
    expect(await search("500 9807")).toEqual([expect.objectContaining({ sku: "EDG-Z46", match_type: "exact" })]);
    expect(await search("SF427")).toEqual([expect.objectContaining({ sku: "EDG-Z20", match_type: "exact" })]);
    for (const holder of ["09", "15"]) {
      const hits = await search(`CB${holder}U`);
      expect(hits.map(({ sku }) => sku)).toEqual([`EDG-GRP-CB${holder}-45`, `EDG-GRP-CB${holder}-60`]);
      expect(hits.every(({ match_type, requires_choice }) => match_type === "exact" && requires_choice)).toBe(true);
    }
    expect(await search("BLD-SF216")).toEqual([]);
  } finally {
    await db.query("rollback");
    await db.query("set role anon");
  }
});

test("unpriced drafts can receive stock but cannot take a partial price set or publish", async () => {
  await db.query("reset role");
  await db.query("begin");
  try {
    await db.query(`
      with family as (
        insert into public.products (family_code, slug, name, tool_category)
        values ('TEST-UNPRICED', 'test-unpriced', 'Unpriced test blades', 'drag') returning id
      )
      insert into public.variants (product_id, sku)
      select id, sku from family cross join (values ('TEST-UNPRICED-A'), ('TEST-UNPRICED-B')) as fixtures(sku)
    `);
    const { rows: [actor] } = await db.query<{ user_id: string }>(`
      with actor as (insert into auth.users (id) values (gen_random_uuid()) returning id)
      insert into public.staff_members (user_id, role) select id, 'warehouse' from actor returning user_id
    `);
    await db.query(`
      select public.receive_stock(id, 'test:draft-stock', 2, $1)
      from public.variants where sku = 'TEST-UNPRICED-A'
    `, [actor!.user_id]);
    const { rows } = await db.query(`
      select sku, stock_on_hand, publication_status from public.variants
      where sku in ('TEST-UNPRICED-A', 'TEST-UNPRICED-B') order by sku
    `);
    expect(rows).toEqual([
      { sku: "TEST-UNPRICED-A", stock_on_hand: 2, publication_status: "draft" },
      { sku: "TEST-UNPRICED-B", stock_on_hand: 0, publication_status: "draft" },
    ]);
    await db.query("savepoint before_partial_price");
    await expect(db.query("update public.variants set price_1_4_pence = 1000 where sku = 'TEST-UNPRICED-A'"))
      .rejects.toMatchObject({ constraint: "variants_prices_required_outside_draft" });
    await db.query("rollback to before_partial_price");
    await expect(db.query(`
      update public.variants set publication_status = 'published', approved_at = now(), supplier_part_number = 'TEST'
      where sku = 'TEST-UNPRICED-A'
    `)).rejects.toMatchObject({ constraint: "variants_prices_required_outside_draft" });
  } finally {
    await db.query("rollback");
    await db.query("set role anon");
  }
});

test("unpublishing a variant or withdrawing a mapping takes effect immediately", async () => {
  await db.query("reset role");
  await db.query("begin");
  try {
    await db.query("update public.variants set publication_status = 'draft' where sku = 'EDG-Z10'");
    await db.query("update public.compatibility set verification_state = 'candidate' where code = '3910306'");
    await db.query("set local role anon");
    expect(await search("3910301")).toEqual([]);
    expect(await search("3910306")).toEqual([]);
    expect(await search("EDG-Z16")).toHaveLength(1);
  } finally {
    await db.query("rollback");
    await db.query("set role anon");
  }
});

test("new public tables do not implicitly grant access to API roles", async () => {
  await db.query("reset role");
  await db.query("begin");
  try {
    await db.query("create table public.grants_probe (id integer)");
    const { rows } = await db.query(`
      select role, has_table_privilege(role, 'public.grants_probe', 'SELECT') as can_read
      from unnest(array['anon', 'authenticated']) as role
    `);
    expect(rows).toEqual([
      { role: "anon", can_read: false },
      { role: "authenticated", can_read: false },
    ]);
  } finally {
    await db.query("rollback");
    await db.query("set role anon");
  }
});
