import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { promiseForReservedOrder } from "@/lib/delivery/terms";
import { setDbClaims } from "../helpers/db-claims";
import { connectAccountDb, createAccountBuyer, createAccountCatalogue } from "../helpers/account-fixture";

test("warehouse alone edits delivery policy and a district overrides its area without fallback", async () => {
  const db = await connectAccountDb();
  await db.query("begin");
  try {
    const [warehouse, finance] = [await createAccountBuyer(db), await createAccountBuyer(db)];
    await db.query("insert into public.staff_members (user_id, role) values ($1, 'warehouse'), ($2, 'finance')",
      [warehouse.id, finance.id]);
    const actor = async (id: string) => {
      await db.query("reset role");
      await setDbClaims(db, "authenticated", id, true);
      await db.query("set local role authenticated");
    };
    await actor(finance.id);
    expect((await db.query("select * from public.delivery_rules")).rows).toEqual([]);
    expect((await db.query("select * from public.delivery_calendars")).rows).toEqual([]);
    const insertRule = "insert into public.delivery_rules (scope, code, kind) values ('district', 'SW1A', 'enquiry')";
    await db.query("savepoint unauthorized");
    await expect(db.query(insertRule)).rejects.toMatchObject({ code: "42501" });
    await db.query("rollback to savepoint unauthorized");

    await actor(warehouse.id);
    await expect(db.query(insertRule)).resolves.toMatchObject({ rowCount: 1 });
    await expect(db.query("update public.delivery_calendars set closures = array[date '2026-11-24'] where calendar = 'warehouse'"))
      .resolves.toMatchObject({ rowCount: 1 });
    await db.query("savepoint invalid");
    await expect(db.query("update public.delivery_rules set kind = 'agreed', working_days = 3 where code = 'SW1A'"))
      .rejects.toMatchObject({ code: "23514" });
    await db.query("rollback to savepoint invalid");
    for (const fn of ["checkout_delivery_terms('SW1A 1AA')", "checkout_warehouse_calendar()"]) {
      await db.query("savepoint checkout_read");
      await expect(db.query(`select public.${fn}`)).rejects.toMatchObject({ code: "42501" });
      await db.query("rollback to savepoint checkout_read");
    }

    await db.query("reset role; set local role service_role");
    const resolve = async (postcode: string) =>
      (await db.query("select public.checkout_delivery_terms($1) as terms", [postcode])).rows[0]?.terms;
    expect(await resolve("SW1A 1AA")).toBeNull();
    const terms = await resolve("SW2 1AA");
    expect(terms).toMatchObject({
      version: 1,
      quote: { kind: "next-working-day", chargeExVatPence: 695, workingDays: 1 },
      warehouseCalendar: { closures: ["2026-11-24"] },
      deliveryCalendar: { closures: [] },
    });
    expect(await resolve("BT1 5GS")).toBeNull();
    const attemptToken = randomUUID();
    const reserve = (snapshot: unknown, paymentMethod: "card" | "net30", buyerId: string | null) =>
      db.query(`select public.reserve_order_with_delivery(
        $1, '[]', '{}', '{"postcode":"SW3 1AA"}', '{"goods_net_pence":2250,"delivery_net_pence":695}',
        now() + interval '35 minutes', 'Next working day', date '2026-11-24', date '2026-11-25',
        $2::jsonb, $3, $4, null
      )`, [attemptToken, snapshot, paymentMethod, buyerId]);
    for (const [snapshot, method, buyerId, message] of [
      [{ ...terms, cutoffMinutes: 929 }, "card", null, "delivery_terms_changed"],
      [null, "card", null, "invalid_delivery_terms"],
      [{ ...terms, version: 2 }, "card", null, "invalid_delivery_terms"],
      [terms, "net30", warehouse.id, "invalid_reservation_payment_method"],
    ] as const) {
      await db.query("savepoint invalid_reservation");
      await expect(reserve(snapshot, method, buyerId)).rejects.toMatchObject({ code: "22023", message });
      await db.query("rollback to savepoint invalid_reservation");
    }
    expect((await db.query("select id from public.orders where checkout_attempt_token=$1", [attemptToken])).rowCount).toBe(0);
    await db.query("reset role; delete from public.delivery_calendars where calendar = 'carrier'; set local role service_role");
    expect(await resolve("SW2 1AA")).toBeNull();
    const schedule = (await db.query("select public.checkout_warehouse_calendar() as schedule")).rows[0]?.schedule;
    expect(schedule).toEqual({ warehouseCalendar: terms.warehouseCalendar, cutoffMinutes: terms.cutoffMinutes });
    await db.query("reset role; set local role anon");
    await expect(db.query("select public.checkout_warehouse_calendar()")).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.query("rollback");
    await db.end();
  }
});

test("merges official dates with old calendar entries and freezes them on new orders", async () => {
  const db = await connectAccountDb();
  await db.query("begin");
  try {
    const { available } = await createAccountCatalogue(db);
    await db.query(`
      update public.delivery_calendars
      set active_from = '2026-11-23',
        active_through = case when calendar = 'warehouse' then date '2026-11-26' else date '2026-11-30' end,
        working_weekdays = '{1,2,3,4,5}',
        bank_holidays = case when calendar = 'warehouse' then '{2026-11-24,2026-11-25}'::date[] else '{2026-11-27}'::date[] end,
        closures = case when calendar = 'carrier' then '{2026-11-26}'::date[] else '{}'::date[] end
    `);
    await db.query("set local role service_role");
    const official = ["2026-11-27", "2026-11-23", "2026-11-24", "2026-11-24"];
    const { rows: [delivery] } = await db.query<{ terms: unknown }>(
      "select public.checkout_delivery_terms('SW3 1AA', $1) as terms", [official],
    );
    const terms = delivery?.terms;
    const warehouseCalendar = { bankHolidays: ["2026-11-23", "2026-11-24", "2026-11-25"], closures: [] };
    const deliveryCalendar = { bankHolidays: ["2026-11-23", "2026-11-24", "2026-11-27"], closures: ["2026-11-26"] };
    expect(terms).toMatchObject({ warehouseCalendar, deliveryCalendar, cutoffMinutes: 930 });
    const { rows: [schedule] } = await db.query<{ schedule: unknown }>(
      "select public.checkout_warehouse_calendar($1) as schedule", [official],
    );
    expect(schedule?.schedule).toMatchObject({ warehouseCalendar, cutoffMinutes: 930 });

    const attempt = randomUUID();
    const reserve = async (dates: string[]) => db.query<{ id: string; delivery_terms: unknown; delivery_service: string }>(`
      select id, delivery_terms, delivery_service from public.reserve_order_with_delivery(
        $1, $2::jsonb, '{"email":"fixture@example.test","business_name":"Test","recipient_name":"Buyer","buying_for_work":true}',
        '{"line1":"1 Example Street","town":"London","postcode":"SW3 1AA","country":"GB"}',
        '{"goods_net_pence":2350,"delivery_net_pence":695,"vat_rate_bps":2000,"vat_pence":609,"gross_pence":3654}',
        now() + interval '35 minutes', 'Next working day', date '2026-11-26', date '2026-11-30',
        $3::jsonb, 'card', null, null, $4
      )
    `, [attempt, JSON.stringify([{ variant_id: available.id, quantity: 1, unit_price_pence: 2350 }]), terms, dates]);
    await db.query("savepoint stale_feed");
    await expect(reserve(["2026-11-27"])).rejects.toMatchObject({ message: "delivery_terms_changed" });
    await db.query("rollback to savepoint stale_feed");
    const { rows: [reserved] } = await reserve(official);
    expect(reserved?.delivery_terms).toEqual(terms);
    expect(promiseForReservedOrder(reserved!, "2026-11-23T10:00:00Z")).toEqual({
      dispatchDate: "2026-11-26", deliveryDate: "2026-11-30",
    });
    expect((await reserve([])).rows).toEqual([reserved]);
  } finally {
    await db.query("rollback");
    await db.end();
  }
});
