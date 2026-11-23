import { redirect } from "next/navigation";
import { AdminHeading, AdminLink, AdminNotice } from "@/app/admin/ui";
import { staffDestinationLabels, trialFollowUpsHref } from "@/lib/admin/navigation";
import { requestsDb } from "@/lib/admin/request-schema";
import { requestVariantLabels, requireRequestsStaff, variantLabel } from "@/lib/admin/requests";
import { displayTrialDate } from "@/lib/admin/trial-follow-ups";
import styles from "./queue.module.css";

const title = staffDestinationLabels.trialFollowUps;
const pageSize = 24;
export const metadata = { title };

export default async function TrialFollowUpsPage({ searchParams }: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { db } = await requireRequestsStaff();
  const { page: rawPage } = await searchParams;
  const value = typeof rawPage === "string" && /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const page = Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000 ? value : 1;
  const start = (page - 1) * pageSize;
  const { data: trials, error, count } = await requestsDb(db)
    .rpc("admin_trial_follow_up_status", {}, { count: "exact" })
    .order("dispatched_at").order("trial_request_id").range(start, start + pageSize - 1);
  if (page > 1 && error?.code === "PGRST103") redirect(trialFollowUpsHref);
  if (error) throw new Error("Could not load the trial follow-ups.");

  const { data: allocations, error: allocationError } = trials.length
    ? await db.from("trial_allocations").select("trial_request_id,variant_id,quantity")
      .in("trial_request_id", trials.map((trial) => trial.trial_request_id)).order("variant_id")
    : { data: [], error: null };
  if (allocationError) throw new Error("Could not load the blades sent.");
  const labels = await requestVariantLabels([...new Set(allocations.map((blade) => blade.variant_id))]);
  const bladesByTrial = Map.groupBy(allocations, (blade) => blade.trial_request_id);

  return <>
    <AdminHeading title={title} description="Trials due for a sales follow-up, oldest dispatch first." />
    {!trials.length ? <AdminNotice>{page === 1
      ? "No trial follow-ups due. You’re caught up."
      : "No trials on this page."}</AdminNotice> : (
      <ul className="admin-grid list-none p-0" role="list" aria-label="Trials due for follow-up">
        {trials.map((trial) => (
          <li className="admin-panel" key={trial.trial_request_id}>
            <h2 className={styles.company}>
              <AdminLink href={`/admin/requests/trials/${trial.trial_request_id}#sales-follow-up`}>{trial.company}</AdminLink>
            </h2>
            <dl className="admin-spec">
              <div><dt>Work email</dt><dd>{trial.email}</dd></div>
              <div><dt>Blades sent</dt><dd>{bladesByTrial.get(trial.trial_request_id)?.map((blade) =>
                <span key={blade.variant_id} className="block">{blade.quantity} × {variantLabel(labels.get(blade.variant_id))}</span>
              ) ?? "Unavailable"}</dd></div>
              <div><dt>Dispatched</dt><dd><time dateTime={trial.dispatched_on}>{displayTrialDate(trial.dispatched_on)}</time></dd></div>
              {trial.due_on && <div><dt>Follow-up due</dt><dd><time dateTime={trial.due_on}>{displayTrialDate(trial.due_on)}</time></dd></div>}
              <div><dt>Days waiting</dt><dd>{trial.days_waiting}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    )}
    {(page > 1 || start + pageSize < (count ?? 0)) && (
      <nav className="admin-pagination" aria-label="Trial follow-up pages">
        {page > 1 && <AdminLink href={`${trialFollowUpsHref}${page === 2 ? "" : `?page=${page - 1}`}`}>Previous page</AdminLink>}
        <span>Page {page}</span>
        {start + pageSize < (count ?? 0) && <AdminLink href={`${trialFollowUpsHref}?page=${page + 1}`}>Next page</AdminLink>}
      </nav>
    )}
  </>;
}
