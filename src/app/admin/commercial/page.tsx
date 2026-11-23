import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { commercialDb } from "@/lib/commercial/database";
import { AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "../ui";

export const metadata = { title: staffDestinationLabels.shopPerformance };

function share(numerator: number, denominator: number) {
  return denominator ? `${numerator} of ${denominator} (${new Intl.NumberFormat("en-GB", {
    style: "percent", maximumFractionDigits: 1,
  }).format(numerator / denominator)})` : "Not available (no eligible records)";
}

export default async function CommercialPage() {
  const { db } = await requireStaff("warehouse");
  const { data, error } = await commercialDb(db).rpc("admin_commercial_measures");
  if (error || !data) throw new Error("Could not load commercial measures.");
  const { finder, trials, dispatch, wrongFit, uncategorisedReturns } = data;

  return <>
    <AdminHeading title={staffDestinationLabels.shopPerformance} description="Pilot measures across all retained records. For staff use only." />
    <AdminLink href="/admin">Staff desk</AdminLink>
    <AdminSection title="Finder searches">
      <dl className="admin-spec">
        <dt>Exact</dt><dd>{finder.exact}</dd>
        <dt>Suggested</dt><dd>{finder.suggested}</dd>
        <dt>Unmatched</dt><dd>{finder.unmatched}</dd>
        <dt>Observed exact-match conversion</dt><dd>{share(finder.converted, finder.exact)}</dd>
        <dt>Linked to a checkout without authorisation</dt><dd>{finder.linkedWithoutAuthorisation}</dd>
        <dt>No attributed checkout</dt><dd>{finder.noLink}</dd>
      </dl>
      <p>An observed conversion is a tracked exact search linked to a matching order line in a paid card or authorised Net 30 order. Only the latest exact search in an opted-in browser within 30 minutes is eligible. No link is not proof that no purchase occurred.</p>
    </AdminSection>
    <AdminSection title="Trial packs">
      <dl className="admin-spec">
        <dt>Dispatched trials linked to a first purchase</dt><dd>{share(trials.firstPurchases, trials.dispatched)}</dd>
        <dt>Dispatched trials with no confirmed order link</dt><dd>{trials.dispatched - trials.linked}</dd>
      </dl>
      <p>Only staff-confirmed links to a qualifying first purchase count. Unlinked trials stay in the denominator but may still have led to a purchase.</p>
    </AdminSection>
    <AdminSection title="Dispatch promise">
      <dl className="admin-spec">
        <dt>Dispatched on or before the promised date</dt><dd>{share(dispatch.onTime, dispatch.withPromise)}</dd>
        <dt>Dispatched orders without a recorded promise</dt><dd>{dispatch.total - dispatch.withPromise}</dd>
      </dl>
      <p>The denominator is dispatched orders with a saved promise. Dispatch dates use UK local time; orders not yet dispatched are not counted.</p>
    </AdminSection>
    <AdminSection title="Wrong-fit returns">
      <p>Grouped by variant and reported code if it matches the published catalogue, otherwise by the exact Finder code linked to the order line. Other reported codes stay in the return record. Older uncategorised returns are excluded: {uncategorisedReturns}. A missing code remains unassigned.</p>
      {wrongFit.length ? <AdminTable label="Wrong-fit returns by variant and lookup code"
        headers={["Variant", "Lookup code", "Return records", "Units"]}>
        {wrongFit.map((group) => <tr key={JSON.stringify([group.sku, group.code])}>
          <th scope="row">{group.sku}</th><td>{group.code ?? "Not attributed"}</td><td>{group.records}</td><td>{group.units}</td>
        </tr>)}
      </AdminTable> : <AdminNotice>No structured wrong-fit returns have been recorded.</AdminNotice>}
    </AdminSection>
  </>;
}
