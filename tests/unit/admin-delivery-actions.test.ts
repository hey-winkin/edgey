import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commitDelivery, importDeliveryLines, lookupDeliveryCodes } from "@/app/admin/stock/receive/actions";
import { GET as deliveryTemplate } from "@/app/admin/stock/receive/template/route";

const { staffSession, rpc, revalidatePath } = vi.hoisted(() => ({
  staffSession: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({ staffSession }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("server-only", () => ({}));

function payload() {
  const line = { variantId: randomUUID(), quantity: 5, unitCostPence: 301 };
  return {
    id: randomUUID(), reference: " Test carton ", receivedOn: "2024-01-15", note: "",
    lines: [line] as [typeof line],
  };
}

describe("delivery server boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    staffSession.mockResolvedValue({ roles: ["warehouse", "finance"], db: { rpc } });
  });

  it("requires warehouse access for lookup, import, template and commit", async () => {
    staffSession.mockResolvedValue({ roles: ["finance"], db: { rpc } });
    const form = new FormData();
    form.set("paste", "FIXTURE,5,4.56");
    await expect(lookupDeliveryCodes(["FIXTURE"])).resolves.toMatchObject({ ok: false });
    await expect(importDeliveryLines(form)).resolves.toMatchObject({ ok: false });
    await expect(commitDelivery(payload())).resolves.toMatchObject({ ok: false });
    expect((await deliveryTemplate()).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not send unpermitted costs, invalid quantities or duplicate variants to the database", async () => {
    const input = payload();
    staffSession.mockResolvedValueOnce({ roles: ["warehouse"], db: { rpc } });
    await expect(commitDelivery(input)).resolves.toMatchObject({ ok: false });
    await expect(commitDelivery({ ...input, lines: [...input.lines, ...input.lines] })).resolves.toMatchObject({ ok: false });
    await expect(commitDelivery({ ...input, lines: [{ ...input.lines[0], quantity: -4 }] })).resolves.toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the entire reviewed delivery in one call with the same id on retry", async () => {
    const input = payload();
    const args = {
      p_delivery_id: input.id, p_reference: "Test carton", p_received_on: input.receivedOn, p_note: "",
      p_lines: [{ variant_id: input.lines[0].variantId, quantity: 5, unit_cost_pence: 301 }],
    };
    rpc.mockResolvedValueOnce({ error: { code: "", message: "connection lost" } })
      .mockResolvedValueOnce({ data: input.id, error: null });
    await expect(commitDelivery(input)).resolves.toMatchObject({ ok: false, retryOnly: true });
    await expect(commitDelivery(input)).resolves.toEqual({ ok: true, id: input.id });
    expect(rpc.mock.calls).toEqual([
      ["receive_staff_delivery", args],
      ["receive_staff_delivery", args],
    ]);
  });

  it("batches distinct code lookups and redacts the cost column from warehouse previews", async () => {
    staffSession.mockResolvedValue({ roles: ["warehouse"], db: { rpc } });
    const variant = randomUUID();
    rpc.mockResolvedValue({ error: null, data: [{ input_code: "DEMO-A", variant_id: variant, sku: "DEMO-A", blade_name: "Demo blade" }] });
    const form = new FormData();
    form.set("paste", "code,quantity,unit cost\nDEMO-A,12,12.34\nDEMO-A,7,98.76\n,2,4.56");
    const result = await importDeliveryLines(form);
    expect(result).toEqual({
      ok: true,
      matches: [{ inputCode: "DEMO-A", variantId: variant, sku: "DEMO-A", bladeName: "Demo blade" }],
      rows: [
        { sourceRow: 2, code: "DEMO-A", quantity: "12", unitCost: "" },
        { sourceRow: 3, code: "DEMO-A", quantity: "7", unitCost: "" },
        { sourceRow: 4, code: "", quantity: "2", unitCost: "" },
      ],
    });
    expect(rpc.mock.calls).toEqual([["match_staff_delivery_codes", { p_codes: ["DEMO-A"] }]]);
  });

  it("rejects non-UTF-8 and oversized uploads before lookup", async () => {
    const form = new FormData();
    form.set("file", new File([Uint8Array.from([0xff, 0xfe])], "sample.csv"));
    await expect(importDeliveryLines(form)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("UTF-8 CSV") });
    form.set("file", new File(["x".repeat(128 * 1024 + 1)], "sample.csv"));
    await expect(importDeliveryLines(form)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("128 KB") });
    expect(rpc).not.toHaveBeenCalled();
  });
});
