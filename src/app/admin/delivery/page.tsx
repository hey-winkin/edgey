import type { Metadata } from "next";
import { requireStaff } from "@/lib/admin/auth";
import { staffDestinationLabels } from "@/lib/admin/navigation";
import { formatPoundsInput } from "@/lib/admin/pounds";
import { formatGbp } from "@/lib/commerce";
import { BANK_HOLIDAYS_URL, otherClosureDates, readBankHolidays } from "@/lib/delivery/bank-holidays";
import type { Database } from "@/lib/supabase/database.types";
import { AdminField, AdminForm, AdminHeading, AdminLink, AdminNotice, AdminSection, AdminTable } from "../ui";
import { removeDeliveryRule, saveDeliveryCalendar, saveDeliveryRule } from "./actions";

export const metadata: Metadata = { title: staffDestinationLabels.customerDeliverySettings };

type Calendar = Database["public"]["Tables"]["delivery_calendars"]["Row"];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const path = "/admin/delivery";
const ukDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" });
const londonDateKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});

function formatCutoff(minutes: number | null | undefined) {
  return minutes == null ? "" : [Math.floor(minutes / 60), minutes % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

function CalendarEditor({ kind, calendar, officialHolidays }: {
  kind: "warehouse" | "carrier";
  calendar?: Calendar;
  officialHolidays: ReadonlySet<string>;
}) {
  return <AdminSection title={kind === "warehouse" ? "Warehouse calendar" : "Carrier calendar"}>
    <AdminForm action={saveDeliveryCalendar.bind(null, kind)} submit={kind === "warehouse" ? "Save warehouse calendar" : "Save carrier calendar"}>
      <div className="admin-grid">
        <AdminField label="Active from"><input name="from" type="date" defaultValue={calendar?.active_from} required /></AdminField>
        <AdminField label="Active through"><input name="through" type="date" defaultValue={calendar?.active_through} required /></AdminField>
      </div>
      {kind === "warehouse" && <AdminField label="Dispatch cut-off (London time)">
        <input name="cutoff" type="time" defaultValue={formatCutoff(calendar?.cutoff_minutes)} required />
      </AdminField>}
      <fieldset>
        <legend>Working days</legend>
        {weekdays.map((day, index) => <label key={day} className="admin-check">
          <input type="checkbox" name="weekday" value={index} defaultChecked={calendar?.working_weekdays.includes(index)} /> {day}
        </label>)}
      </fieldset>
      <AdminField label="Other closures (YYYY-MM-DD)">
        <textarea name="closures" rows={3} maxLength={44000}
          defaultValue={calendar && otherClosureDates(calendar, officialHolidays).join("\n")} />
      </AdminField>
    </AdminForm>
  </AdminSection>;
}

export default async function DeliverySettings({ searchParams }: {
  searchParams: Promise<{ scope?: string | string[]; code?: string | string[] }>;
}) {
  const { db } = await requireStaff("warehouse");
  const [rules, calendars, params, bankHolidays] = await Promise.all([
    db.from("delivery_rules").select("*").order("scope").order("code"),
    db.from("delivery_calendars").select("*"),
    searchParams,
    readBankHolidays(),
  ]);
  if (rules.error || calendars.error) throw new Error("Couldn’t load delivery settings.");
  const rule = rules.data.find(({ scope, code }) => scope === params.scope && code === params.code);
  const officialHolidays = new Set(bankHolidays.events.map(({ date }) => date));
  const today = londonDateKey.format(new Date());
  const currentYear = Number(today.slice(0, 4));
  const nextYearEnd = `${currentYear + 1}-12-31`;
  const upcoming = bankHolidays.events.filter(({ date }) => date >= today && date <= nextYearEnd);
  const holidaysByYear = Object.groupBy(upcoming, ({ date }) => date.slice(0, 4));
  const usesSavedDates = bankHolidays.supplementedDates.some((date) => date >= today && date <= nextYearEnd);

  return <>
    <AdminHeading title={staffDestinationLabels.customerDeliverySettings} eyebrow="Warehouse"
      description="Enter carrier-approved coverage, service terms and dates. Changes apply to new reservations only." />
    <AdminLink href="/admin">Staff desk</AdminLink>
    {calendars.data.length < 2 && <AdminNotice>Checkout cannot quote delivery until both calendars are configured.</AdminNotice>}
    <AdminSection title={rule ? `Edit ${rule.code} ${rule.scope} rule` : "Add or update a postcode rule"}>
      <p>A district rule takes priority over its area. Use Enquiry only to exclude a postcode district inside a covered area. Unlisted destinations require an enquiry.</p>
      {rule && <AdminLink href={path}>Add another rule</AdminLink>}
      <AdminForm key={rule && `${rule.scope}:${rule.code}`} action={saveDeliveryRule} submit="Save postcode rule">
        <div className="admin-grid">
          <AdminField label="Rule scope"><select name="scope" defaultValue={rule?.scope ?? "area"}>
            <option value="area">Area</option><option value="district">District</option>
          </select></AdminField>
          <AdminField label="Postcode area or district"><input name="code" maxLength={4} placeholder="SW or SW1A" defaultValue={rule?.code} required /></AdminField>
          <AdminField label="Service type"><select name="kind" defaultValue={rule?.kind ?? "enquiry"}>
            <option value="enquiry">Enquiry only</option>
            <option value="next-working-day">Next working day</option>
            <option value="agreed">Agreed slower service</option>
          </select></AdminField>
          <AdminField label="Service name"><input name="service" maxLength={100} defaultValue={rule?.service_name ?? undefined} /></AdminField>
          <AdminField label="Carrier (optional, staff only)"><input name="carrier" maxLength={100} defaultValue={rule?.dispatch_carrier ?? undefined} /></AdminField>
          <AdminField label="Agreed price ex VAT (£)"><input name="chargeGbp" inputMode="decimal"
            defaultValue={rule?.kind === "agreed" ? formatPoundsInput(rule.charge_ex_vat_pence) : undefined} /></AdminField>
          <AdminField label="Agreed transit (working days)"><input name="days" inputMode="numeric" maxLength={3}
            defaultValue={rule?.kind === "agreed" ? rule.working_days ?? undefined : undefined} /></AdminField>
        </div>
        <p className="admin-muted">The carrier helps staff record dispatch. Customers still see only the service name.</p>
        <p className="admin-muted">Standard next-working-day delivery is £6.95 ex VAT, free from £150 ex VAT. Price and transit fields apply only to an agreed service.</p>
      </AdminForm>
      {rule && <AdminForm action={removeDeliveryRule.bind(null, rule.scope, rule.code)} submit="Remove rule"
        confirmation={{
          description: "New delivery quotes will use a broader area rule if one exists. Otherwise these postcodes become enquiry only.",
          label: `I confirm the delivery rule for ${rule.code} should be removed.`,
          submit: "Remove delivery rule",
        }} />}
    </AdminSection>
    <AdminSection title="Configured rules">
      {rules.data.length ? (["district", "area"] as const).map((scope) => {
        const matching = rules.data.filter((item) => item.scope === scope);
        return <details key={scope} open={scope === "district" || scope === rule?.scope}>
          <summary>{scope === "district" ? "District overrides" : "Area rules"} ({matching.length})</summary>
          {matching.length ? <AdminTable label={scope === "district" ? "District overrides" : "Area rules"} headers={["Postcode", "Service", "Carrier", "Charge ex VAT", "Working days"]}>
            {matching.map((item) => <tr key={item.code}>
              <td><AdminLink href={`${path}?scope=${scope}&code=${item.code}`}>{item.code}</AdminLink></td>
              <td>{item.service_name ?? "Enquiry only"}</td>
              <td>{item.dispatch_carrier ?? "—"}</td>
              <td>{item.charge_ex_vat_pence == null ? "—" : formatGbp(item.charge_ex_vat_pence)}</td>
              <td>{item.working_days ?? "—"}</td>
            </tr>)}
          </AdminTable> : <AdminNotice>No rules at this level.</AdminNotice>}
        </details>;
      }) : <AdminNotice>No postcode rules configured.</AdminNotice>}
    </AdminSection>
    <AdminSection title="Bank holidays (England and Wales)">
      <p>Bank holidays from <a href={BANK_HOLIDAYS_URL} className="textlink">GOV.UK</a> apply automatically within each calendar’s active dates. Use Other closures for any additional days off.</p>
      <p className="admin-muted">
        {bankHolidays.source === "snapshot" ? "Using the saved GOV.UK calendar. Snapshot date: " : "Last refreshed: "}
        <time dateTime={bankHolidays.refreshedAt}>{ukDate.format(new Date(bankHolidays.refreshedAt))}</time>
        {usesSavedDates && ". Some dates are from the saved GOV.UK calendar."}
      </p>
      {!upcoming.length && <AdminNotice>No upcoming bank holidays in the available calendar.</AdminNotice>}
      {Object.entries(holidaysByYear).map(([year, events]) => <details key={year} open>
        <summary>{year} bank holidays</summary>
        <AdminTable label={`England and Wales bank holidays in ${year}`} headers={["Date", "Bank holiday"]}>
          {events?.map(({ date, title, notes }) => <tr key={`${date}:${title}`}>
            <td><time dateTime={date}>{ukDate.format(new Date(date))}</time></td>
            <td>{title}{notes && ` (${notes})`}</td>
          </tr>)}
        </AdminTable>
      </details>)}
    </AdminSection>
    <div className="admin-grid">
      <CalendarEditor kind="warehouse" calendar={calendars.data.find(({ calendar }) => calendar === "warehouse")} officialHolidays={officialHolidays} />
      <CalendarEditor kind="carrier" calendar={calendars.data.find(({ calendar }) => calendar === "carrier")} officialHolidays={officialHolidays} />
    </div>
  </>;
}
