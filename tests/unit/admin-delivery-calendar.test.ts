import { beforeEach, expect, test, vi } from "vitest";
import { saveDeliveryCalendar } from "@/app/admin/delivery/actions";

const { upsert, requireStaff, revalidatePath } = vi.hoisted(() => ({
  upsert: vi.fn(), requireStaff: vi.fn(), revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({ requireStaff }));
vi.mock("next/cache", () => ({ revalidatePath }));

beforeEach(() => {
  vi.resetAllMocks();
  upsert.mockResolvedValue({ error: null });
  requireStaff.mockResolvedValue({ db: { from: (table: string) => {
    expect(table).toBe("delivery_calendars");
    return { upsert };
  } } });
});

function formWithClosures(closures: string) {
  const form = new FormData();
  form.set("from", "2026-01-01");
  form.set("through", "2026-12-31");
  form.set("cutoff", "15:30");
  form.set("closures", closures);
  form.set("bankHolidays", "2026-08-14");
  form.append("weekday", "1");
  return form;
}

test("saves Other closures and ignores the removed bank holidays field", async () => {
  const form = formWithClosures("2026-12-29, 2026-12-24\n2026-12-29");
  await expect(saveDeliveryCalendar("warehouse", null, form)).resolves.toMatchObject({ ok: true });
  expect(requireStaff).toHaveBeenCalledWith("warehouse");
  expect(upsert).toHaveBeenCalledWith({
    calendar: "warehouse", active_from: "2026-01-01", active_through: "2026-12-31",
    working_weekdays: [1], bank_holidays: [], closures: ["2026-12-24", "2026-12-29"], cutoff_minutes: 930,
  });
  expect(revalidatePath).toHaveBeenCalledWith("/admin/delivery");
});

test.each(["2026-02-30", "2027-01-01"])("rejects an invalid or out-of-range closure %s", async (closure) => {
  await expect(saveDeliveryCalendar("warehouse", null, formWithClosures(closure))).resolves.toMatchObject({ ok: false });
  expect(upsert).not.toHaveBeenCalled();
});
