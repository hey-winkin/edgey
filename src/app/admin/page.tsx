import Link from "next/link";
import { requireStaff } from "@/lib/admin/auth";
import { staffDeskCounts } from "@/lib/admin/desk";
import { salesOrderReminder, staffAreas, type StaffTask } from "@/lib/admin/navigation";
import { hasPurchasingRole } from "@/lib/admin/roles";
import { readRunningLow, runningLowHref } from "@/lib/admin/running-low";
import { OrderStockLink } from "./purchase-orders/order-stock-link";
import { AdminHeading, AdminLink } from "./ui";

const deskTitle = "Staff desk";
export const metadata = { title: deskTitle };

const taskLabels: Record<Exclude<StaffTask, "orders">, [singular: string, plural: string]> = {
  requests: ["customer enquiry to answer or review", "customer enquiries to answer or review"],
  outOfStock: ["published blade variant out of stock", "published blade variants out of stock"],
};

export default async function AdminPage() {
  const { db, roles } = await requireStaff();
  const groups = staffAreas(roles);
  const [counts, runningLow] = await Promise.all([
    staffDeskCounts(db, roles),
    hasPurchasingRole(roles) ? readRunningLow(db) : [],
  ]);
  const caughtUp = runningLow?.length === 0 &&
    groups.every(({ links }) => links.every(({ task }) => !task || counts[task] === 0));

  return (
    <>
      <AdminHeading title={deskTitle} eyebrow="Today’s work" />
      {caughtUp && <p className="admin-desk-clear">You’re caught up on today’s reminders.</p>}
      <div className="admin-desk">
        {groups.map(({ title, links, orderStock }) => {
          const headingId = `staff-desk-${title.toLowerCase().replaceAll(" ", "-")}`;
          const sales = links.find(({ task }) => task === "orders");
          const work = links.flatMap(({ label, href, task, taskHref }) =>
            task && task !== "orders" && counts[task] !== 0
              ? [{ label, href: counts[task] === null ? href : taskHref ?? href, task, count: counts[task] }] : [],
          );
          const shortcuts = links.filter(({ task }) => !task || (task !== "orders" && counts[task] === 0));
          const lowCount = orderStock ? runningLow?.length : undefined;
          const lowUnavailable = orderStock && runningLow === null;
          return (
            <section key={title} className="admin-desk-group" aria-labelledby={headingId}>
              <h2 id={headingId}>{title}</h2>
              {sales && <div className="admin-desk-action">
                <Link href={sales.href} prefetch={false} className="primary"
                  aria-describedby={counts.orders === null ? "staff-sales-count-status" : undefined}>
                  {salesOrderReminder(counts.orders)}
                </Link>
                {counts.orders === null && <p id="staff-sales-count-status" className="admin-muted">Count unavailable</p>}
              </div>}
              {orderStock && <div className="admin-desk-action"><OrderStockLink /></div>}
              {(work.length > 0 || Boolean(lowCount) || lowUnavailable) && <ul className="admin-desk-work" role="list">
                {lowUnavailable && <li>
                  <Link href={runningLowHref} prefetch={false} className="admin-desk-task">
                    <span>Running-low stock <small>Count unavailable</small></span>
                  </Link>
                </li>}
                {!!lowCount && <li>
                  <Link href={runningLowHref} prefetch={false} className="admin-desk-task">
                    <span className="admin-desk-count admin-mono">{lowCount}</span>{" "}
                    <span>{lowCount === 1 ? "blade running low" : "blades running low"}</span>
                  </Link>
                </li>}
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
