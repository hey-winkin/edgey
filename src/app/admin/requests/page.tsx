import { requireStaff } from "@/lib/admin/auth";
import { displayState, displayTimestamp } from "@/lib/admin/format";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { adminPage, adminPageSize, adminRange } from "@/lib/admin/pagination";
import { enquiryStatus, requestBrand, trialStatus } from "@/lib/admin/requests";
import { AdminPagination } from "../pagination";
import { AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "../ui";

type Search = Record<string, string | string[] | undefined>;

export const metadata = { title: staffDestinationLabels.customerEnquiries };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { db, roles } = await requireStaff();
  const viewFit = roles.includes("warehouse") || roles.includes("catalogue");
  const viewTrade = roles.includes("finance");
  const query = await searchParams;
  const pages = { enquiries: adminPage(query.enquiries), trials: adminPage(query.trials), trade: adminPage(query.trade) };
  const [enquiries, trials, trade] = await Promise.all([
    viewFit ? db.from("enquiries").select("id,kind,email,query,postcode,machine_brand,message,status,created_at")
      .order("created_at", { ascending: false }).order("id").range(...adminRange(pages.enquiries)) : null,
    viewFit ? db.from("trial_requests").select("id,machine_brand,oem_code,email,company,postcode,status,created_at")
      .order("created_at", { ascending: false }).order("id").range(...adminRange(pages.trials)) : null,
    viewTrade ? db.from("trade_applications").select("id,company,buyer_name,email,billing_postcode,status,created_at")
      .order("created_at", { ascending: false }).order("id").range(...adminRange(pages.trade)) : null,
  ]);
  if (enquiries?.error || trials?.error || trade?.error) throw new Error("Could not load the requests inbox.");
  const trialRows = trials?.data.slice(0, adminPageSize) ?? [];
  const fulfilments = roles.includes("warehouse") && trialRows.length
    ? await db.from("trial_fulfilments").select("trial_request_id,state").in("trial_request_id", trialRows.map(({ id }) => id))
    : null;
  if (fulfilments?.error) throw new Error("Could not load trial fulfilment statuses.");
  const trialStates = new Map(fulfilments?.data.map((row) => [row.trial_request_id, row.state]));
  const nav = (key: keyof typeof pages, length: number) => <AdminPagination pathname="/admin/requests"
    query={query} parameter={key} page={pages[key]} length={length} />;

  return (
    <>
      <AdminHeading title={staffDestinationLabels.customerEnquiries}
        description={viewFit ? "Review trial requests and respond to enquiries. Access is limited to your assigned roles." : "Review trade applications and record Net 30 decisions."} />
      {enquiries && <AdminSection title="Enquiries">
        {enquiries.data.length ? (
          <AdminTable label="Enquiries" headers={["Type", "Reply address", "Lookup", "Message", "Status", "Received"]}>
            {enquiries.data.slice(0, adminPageSize).map((row) => <tr key={row.id}>
              <td><AdminLink href={`/admin/requests/enquiries/${row.id}`}>{displayState(row.kind)}</AdminLink></td><td className="admin-mono admin-email">{row.email}</td>
              <td>{[row.query, row.machine_brand && requestBrand(row.machine_brand), row.postcode].filter(Boolean).join(" · ") || "—"}</td>
              <td className="admin-request-message">{row.message}</td><td>{enquiryStatus(row.status)}</td>
              <td className="admin-mono">{displayTimestamp(row.created_at)}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No enquiries on this page.</AdminNotice>}
        {nav("enquiries", enquiries.data.length)}
      </AdminSection>}
      {trials && <AdminSection title="Trial requests">
        {trials.data.length ? (
          <AdminTable label="Trial requests" headers={["Company", "Reply address", "Machine", "OEM code", "Postcode", "Status", "Received"]}>
            {trialRows.map((row) => <tr key={row.id}>
              <td><AdminLink href={`/admin/requests/trials/${row.id}`}>{row.company}</AdminLink></td><td className="admin-mono admin-email">{row.email}</td><td>{requestBrand(row.machine_brand)}</td>
              <td className="admin-mono">{row.oem_code}</td><td className="admin-mono">{row.postcode}</td>
              <td>{trialStatus(row.status, trialStates.get(row.id))}</td><td className="admin-mono">{displayTimestamp(row.created_at)}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No trial requests on this page.</AdminNotice>}
        {nav("trials", trials.data.length)}
      </AdminSection>}
      {trade && <AdminSection title="Trade applications">
        {trade.data.length ? (
          <AdminTable label="Trade applications" headers={["Company", "Applicant", "Email", "Billing postcode", "Status", "Received"]}>
            {trade.data.slice(0, adminPageSize).map((row) => <tr key={row.id}>
              <td><AdminLink href={`/admin/requests/trade/${row.id}`}>{row.company}</AdminLink></td><td>{row.buyer_name}</td><td className="admin-mono admin-email">{row.email}</td>
              <td className="admin-mono">{row.billing_postcode}</td><td>{displayState(row.status)}</td>
              <td className="admin-mono">{displayTimestamp(row.created_at)}</td>
            </tr>)}
          </AdminTable>
        ) : <AdminNotice>No trade applications on this page.</AdminNotice>}
        {nav("trade", trade.data.length)}
      </AdminSection>}
    </>
  );
}
