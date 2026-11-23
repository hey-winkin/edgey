import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDeliveryEditor, submitDeliveryEditor } from "@/app/admin/stock/receive/editor-action";
import { makeDeliveryEditorState, readDeliveryDraft, type EditorState } from "@/lib/admin/delivery-editor-state";

const { requireStaff, lookupDeliveryCodes, importDeliveryLines, findRecentDelivery, commitDelivery, redirect } = vi.hoisted(() => ({
  requireStaff: vi.fn(), lookupDeliveryCodes: vi.fn(), importDeliveryLines: vi.fn(),
  findRecentDelivery: vi.fn(), commitDelivery: vi.fn(), redirect: vi.fn(),
}));
vi.mock("@/lib/admin/auth", () => ({ requireStaff }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/admin/stock/receive/actions", () => ({
  lookupDeliveryCodes, importDeliveryLines, findRecentDelivery, commitDelivery,
}));

const blade = { inputCode: "FIX-A", variantId: randomUUID(), bladeName: "Test blade", sku: "FIX-A" };
const today = "2024-04-02";
let state: EditorState;

function formFor(intent: string, fields: [string, string | File][] = []) {
  const form = new FormData();
  form.set("intent", intent);
  for (const [key, value] of fields) form.append(key, value);
  return form;
}

function enteredFields(): [string, string][] {
  return [
    ["deliveryId", state.draft.id], ["reference", "Test carton"], ["receivedOn", "2024-04-01"], ["note", "Fictional parcel"],
    ["row", "1"], ["code:1", "FIX-A"], ["quantity:1", "9"], ["unitCost:1", "2.35"],
  ];
}

describe("delivery editor form transitions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireStaff.mockResolvedValue({ roles: ["warehouse", "finance"] });
    lookupDeliveryCodes.mockResolvedValue({ ok: true, matches: [blade] });
    findRecentDelivery.mockResolvedValue({ ok: true, record: null });
    state = makeDeliveryEditorState(randomUUID(), today);
  });

  it("takes the displayed reference, date, note and line values from submitted controls, not prior state", async () => {
    const reviewed = await runDeliveryEditor(state, formFor("review", enteredFields()));
    expect(reviewed).toMatchObject({
      review: {
        input: {
          id: state.draft.id, reference: "Test carton", receivedOn: "2024-04-01", note: "Fictional parcel",
          lines: [{ variantId: blade.variantId, quantity: 9, unitCostPence: 235 }],
        },
      },
    });
    expect(commitDelivery).not.toHaveBeenCalled();
  });

  it("returns typed values on add, remove and invalid review without changing stock", async () => {
    const added = await runDeliveryEditor(state, formFor("add", enteredFields()));
    expect(added).toMatchObject({ draft: {
      reference: "Test carton", rows: [{ code: "FIX-A", quantity: "9", unitCost: "2.35" }, { code: "" }],
    } });
    const removed = await runDeliveryEditor(state, formFor("remove:7", [
      ...enteredFields(), ["row", "7"], ["code:7", "FIX-B"], ["quantity:7", "2"],
    ]));
    expect(removed).toMatchObject({ draft: { rows: [{ code: "FIX-A", quantity: "9" }] } });
    const unknown = await runDeliveryEditor(state, formFor("review", enteredFields().map(([key, value]) =>
      [key, key === "quantity:1" ? "0" : value],
    )));
    expect(unknown).toMatchObject({ errorAt: "receipt-1-quantity", draft: { rows: [{ quantity: "0" }] } });
    expect(commitDelivery).not.toHaveBeenCalled();
  });

  it("appends a parsed CSV to existing fields and drops cost data for warehouse", async () => {
    requireStaff.mockResolvedValue({ roles: ["warehouse"] });
    const file = new File(["code,quantity\nFIX-B,4"], "fixture.csv");
    const csv = formFor("import", [...enteredFields(), ["file", file]]);
    importDeliveryLines.mockResolvedValue({
      ok: true, rows: [{ sourceRow: 2, code: "FIX-B", quantity: "4", unitCost: "" }], matches: [],
    });
    const preview = await runDeliveryEditor(state, csv);
    expect(importDeliveryLines).toHaveBeenCalledWith(csv);
    expect(preview).toMatchObject({ draft: {
      reference: "Test carton", paste: "", rows: [
        { code: "FIX-A", quantity: "9", unitCost: "" }, { code: "FIX-B", quantity: "4", unitCost: "" },
      ],
    } });
    expect(readDeliveryDraft(csv, false).rows[0]?.unitCost).toBe("");
    expect(commitDelivery).not.toHaveBeenCalled();
  });

  it("does not turn a back request into a commit while retry is locked", async () => {
    const reviewed = await runDeliveryEditor(state, formFor("review", enteredFields())) as EditorState;
    const retry = { ...reviewed, retryOnly: true, error: "Receipt not confirmed." };
    await expect(runDeliveryEditor(retry, formFor("back"))).resolves.toMatchObject(retry);
    expect(commitDelivery).not.toHaveBeenCalled();
  });

  it("does not carry an ambiguous variant selection over to a changed blade code", () => {
    const form = formFor("review", [...enteredFields(), ["selectedCode:1", "OTHER"], ["selectedId:1", blade.variantId]]);
    expect(readDeliveryDraft(form, true).rows[0]?.selectedId).toBeUndefined();
    form.set("selectedCode:1", "FIX-A");
    expect(readDeliveryDraft(form, true).rows[0]?.selectedId).toBe(blade.variantId);
  });

  it("refuses a now-warehouse-only session's stale costed review and sends no cost back", async () => {
    const review = await runDeliveryEditor(state, formFor("review", enteredFields())) as EditorState;
    requireStaff.mockResolvedValue({ roles: ["warehouse"] });
    const result = await runDeliveryEditor(review, formFor("commit"));
    expect(result).toMatchObject({ draft: { rows: [{ unitCost: "" }] }, errorAt: "receipt-review-error" });
    expect(result).not.toHaveProperty("review");
    expect(commitDelivery).not.toHaveBeenCalled();
  });

  it("commits the frozen review with the original id and redirects a native submission after success", async () => {
    const reviewed = await runDeliveryEditor(state, formFor("review", enteredFields())) as EditorState;
    const committed = { ok: true, id: state.draft.id };
    const lost = { ok: false, error: "Receipt not confirmed.", retryOnly: true };
    commitDelivery.mockResolvedValueOnce(lost).mockResolvedValueOnce(committed);
    const failed = await runDeliveryEditor(reviewed, formFor("commit")) as EditorState;
    redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
    await expect(submitDeliveryEditor(failed, formFor("commit"))).rejects.toThrow("REDIRECT");
    expect(commitDelivery.mock.calls).toEqual([[reviewed.review?.input], [reviewed.review?.input]]);
    expect(redirect).toHaveBeenCalledWith(`/admin/stock/deliveries/${state.draft.id}`);
  });
});
