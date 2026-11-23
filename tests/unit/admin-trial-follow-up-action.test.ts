import { beforeEach, expect, test, vi } from "vitest";
import { recordTrialFollowUp } from "@/app/admin/requests/actions";

const { rpc, requireRequestsStaff, revalidatePath } = vi.hoisted(() => ({
  rpc: vi.fn(), requireRequestsStaff: vi.fn(), revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/requests", () => ({ requireRequestsStaff }));
vi.mock("next/cache", () => ({ revalidatePath, unstable_cache: (fn: unknown) => fn }));

const id = "b4205b9c-4604-417f-b880-5d03ff689a57";

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ error: null });
  requireRequestsStaff.mockResolvedValue({ db: { rpc } });
});

function formWith(updates: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ followedOn: "2026-11-23", outcome: "no_reply", ...updates })) {
    form.set(name, value);
  }
  return form;
}

test.each([
  [{ followedOn: "0000-01-01" }, /contact date/],
  [{ outcome: "invalid" }, /choose an outcome/i],
  [{ note: "x".repeat(2001) }, /2,000 characters/],
  [{ outcome: "follow_up_again" }, /next follow-up date/],
  [{ outcome: "follow_up_again", nextOn: "2026-11-23" }, /next follow-up date/],
] as const)("rejects invalid follow-up fields before recording (%j)", async (updates, message) => {
  await expect(recordTrialFollowUp(id, null, null, formWith(updates)))
    .resolves.toMatchObject({ ok: false, message: expect.stringMatching(message) });
  expect(rpc).not.toHaveBeenCalled();
});

test("records under the staff session and refreshes the desk, list and record", async () => {
  await expect(recordTrialFollowUp(id, 42, null, formWith({
    outcome: "follow_up_again", nextOn: "2026-11-30", note: "  Call back. ",
  }))).resolves.toEqual({ ok: true, message: "Follow-up recorded." });
  expect(requireRequestsStaff).toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("record_trial_follow_up", {
    p_trial_request_id: id, p_expected_id: 42, p_followed_on: "2026-11-23", p_outcome: "follow_up_again",
    p_note: "Call back.", p_next_on: "2026-11-30",
  });
  expect(revalidatePath.mock.calls).toEqual([["/admin"], ["/admin/requests/trial-follow-ups"], [`/admin/requests/trials/${id}`]]);
});
