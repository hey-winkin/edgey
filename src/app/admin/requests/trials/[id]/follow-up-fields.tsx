"use client";

import { useState } from "react";
import { AdminField } from "@/app/admin/ui";
import { trialFollowUpOutcomes } from "@/lib/admin/trial-follow-ups";

export function FollowUpFields({ today, dispatchedOn }: { today: string; dispatchedOn: string }) {
  const [followAgain, setFollowAgain] = useState(false);

  return <>
    <AdminField label="Contact date">
      <input type="date" name="followedOn" defaultValue={today} min={dispatchedOn} max={today} required />
    </AdminField>
    <AdminField label="Outcome">
      <select name="outcome" defaultValue="" required onChange={(event) => setFollowAgain(event.target.value === "follow_up_again")}>
        <option value="" disabled>Choose an outcome</option>
        {Object.entries(trialFollowUpOutcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </AdminField>
    {followAgain && <AdminField label="Next follow-up date"><input type="date" name="nextOn" required /></AdminField>}
    <AdminField label="Note (optional)"><textarea name="note" maxLength={2000} rows={3} /></AdminField>
  </>;
}
