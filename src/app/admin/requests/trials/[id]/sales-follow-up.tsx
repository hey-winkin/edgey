import { AdminForm, AdminLink, AdminSection } from "@/app/admin/ui";
import { staffDestinationLabels, trialFollowUpsHref } from "@/lib/admin/navigation";
import { requestsDb } from "@/lib/admin/request-schema";
import { displayTrialDate, trialFollowUpOutcomes, trialFollowUpToday, type TrialFollowUpStatus } from "@/lib/admin/trial-follow-ups";
import { recordTrialFollowUp } from "../../actions";
import { FollowUpFields } from "./follow-up-fields";
import styles from "./follow-up.module.css";

export async function SalesFollowUp({ db, trial }: {
  db: ReturnType<typeof requestsDb>;
  trial: TrialFollowUpStatus;
}) {
  const { data: history, error } = await db.from("trial_follow_ups")
    .select("id,followed_on,outcome,next_on,note")
    .eq("trial_request_id", trial.trial_request_id)
    .order("id", { ascending: false });
  if (error) throw new Error("Could not load the trial follow-up history.");

  const today = trialFollowUpToday();
  return <div id="sales-follow-up">
    <AdminSection title="Sales follow-up">
      <p className="mb-1">
        {trial.converted ? "Converted — a subsequent order is linked." : trial.due_on ? <>
          {trial.due_on <= today ? "Follow-up due: " : "Next follow-up: "}
          <time dateTime={trial.due_on}>{displayTrialDate(trial.due_on)}</time>.
        </> : "No further follow-up scheduled."}
      </p>
      <p className="mb-3"><AdminLink href={trialFollowUpsHref}>{staffDestinationLabels.trialFollowUps}</AdminLink></p>
      {!trial.converted && <div className={`admin-panel admin-narrow mb-5 ${styles.form}`}>
        <AdminForm action={recordTrialFollowUp.bind(null, trial.trial_request_id, trial.latest_id)}
          submit="Record follow-up" preserveOnError>
          <FollowUpFields key={trial.latest_id ?? "first"} today={today} dispatchedOn={trial.dispatched_on} />
        </AdminForm>
      </div>}
      <h3 className="mb-2 font-semibold">Follow-up history</h3>
      {history.length === 0 ? <p className="admin-muted">No follow-ups recorded yet.</p> : (
        <ul className="grid list-none gap-2 p-0" role="list">
          {history.map((entry) => (
            <li key={entry.id} className="admin-panel">
              <p><time dateTime={entry.followed_on}>{displayTrialDate(entry.followed_on)}</time> · <strong>{trialFollowUpOutcomes[entry.outcome]}</strong></p>
              {entry.next_on && <p className="admin-muted">Next follow-up: <time dateTime={entry.next_on}>{displayTrialDate(entry.next_on)}</time></p>}
              {entry.note && <p className="admin-preserve-lines mt-2">{entry.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  </div>;
}
