import Link from "next/link";
import { requireStaff } from "@/lib/admin/auth";
import { staffDeskCounts } from "@/lib/admin/desk";
import { staffAreas, type StaffTask } from "@/lib/admin/navigation";
import { AdminHeading, AdminLink } from "./ui";

const taskLabels: Record<StaffTask, [singular: string, plural: string]> = {
  orders: ["order to pick or dispatch", "orders to pick or dispatch"],
  requests: ["customer request to answer or review", "customer requests to answer or review"],
  outOfStock: ["published blade variant out of stock", "published blade variants out of stock"],
};

export default async function AdminPage() {
  const { db, roles } = await requireStaff();
  const groups = staffAreas(roles);
  const counts = await staffDeskCounts(db, roles);
  const caughtUp = groups.every(({ links }) => links.every(({ task }) => !task || counts[task] === 0));

  return (
    <>
      <AdminHeading title="Staff desk" eyebrow="Today’s work" description="Start with today’s reminders, or open a work area." />
      {caughtUp && <p className="admin-desk-clear">There are no daily reminders to show for your role right now.</p>}
      <div className="admin-desk">
        {groups.map(({ title, links }) => {
          const work = links.flatMap(({ label, href, task, taskHref }) =>
            task && counts[task] !== 0 ? [{ label, href: counts[task] === null ? href : taskHref ?? href, task, count: counts[task] }] : [],
          );
          const shortcuts = links.filter(({ task }) => !task || counts[task] === 0);
          return (
            <section key={title} className="admin-desk-group" aria-labelledby={`staff-desk-${title.toLowerCase()}`}>
              <h2 id={`staff-desk-${title.toLowerCase()}`}>{title}</h2>
              {work.length > 0 && <ul className="admin-desk-work" role="list">
                {work.map(({ label, href, task, count }) => <li key={href}>
                  <Link href={href} prefetch={false} className="admin-desk-task">
                    {count === null ? <span>{label} <small>Count unavailable</small></span> : <>
                      <span className="admin-desk-count admin-mono">{count}</span>{" "}
                      <span>{taskLabels[task][count === 1 ? 0 : 1]}</span>
                    </>}
                  </Link>
                </li>)}
              </ul>}
              {shortcuts.length > 0 && <ul className="admin-desk-links" role="list">
                {shortcuts.map(({ href, label }) => <li key={href}><AdminLink href={href}>{label}</AdminLink></li>)}
              </ul>}
            </section>
          );
        })}
      </div>
    </>
  );
}
