export const trialFollowUpOutcomes = {
  ordered: "Ordered",
  follow_up_again: "Interested — follow up again",
  not_a_fit: "Not a fit",
  no_reply: "No reply",
} as const;

export type TrialFollowUpOutcome = keyof typeof trialFollowUpOutcomes;

export type TrialFollowUpStatus = {
  trial_request_id: string;
  company: string;
  email: string;
  dispatched_at: string;
  dispatched_on: string;
  converted: boolean;
  due_on: string | null;
  days_waiting: number;
  latest_id: number | null;
};

const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});
const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" });

export function trialFollowUpToday() {
  return londonDate.format(new Date());
}

export function displayTrialDate(date: string) {
  return dateLabel.format(new Date(date));
}
