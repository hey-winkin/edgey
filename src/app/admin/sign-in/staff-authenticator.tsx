"use client";

import { useActionState } from "react";
import { AdminForm } from "../form";
import { enrollStaffAuthenticator, verifyStaffAuthenticator } from "../session-actions";

export function StaffAuthenticator({ factors }: { factors: { id: string; label?: string }[] }) {
  const [setup, startSetup, pending] = useActionState(enrollStaffAuthenticator, null);
  if (!factors.length && !setup?.setupKey) {
    return (
      <form className="admin-form" action={startSetup} aria-busy={pending}>
        <p>Set up an authenticator app, such as Google Authenticator or Microsoft Authenticator. The app generates the code; no email is sent.</p>
        <div><button className="primary" disabled={pending}>{pending ? "Setting up…" : "Set up authenticator"}</button></div>
        {setup && <p role="alert">{setup.message}</p>}
      </form>
    );
  }
  return (
    <AdminForm action={verifyStaffAuthenticator} submit="Verify code">
      {setup?.setupKey && <p>In your authenticator app, add a time-based account using this setup key: <code>{setup.setupKey}</code></p>}
      {factors.length > 1 ? (
        <label className="admin-field"><span>Authenticator</span><select name="factorId">
          {factors.map(({ id, label }, index) => <option key={id} value={id}>{label || `Authenticator ${index + 1}`}</option>)}
        </select></label>
      ) : <input type="hidden" name="factorId" value={factors[0]?.id ?? setup?.factorId} />}
      <p id="staff-code-help" className="admin-muted">No email is sent. Open the Edgey entry in your authenticator app, such as Google Authenticator or Microsoft Authenticator.</p>
      <label className="admin-field"><span>Enter the 6-digit code from your authenticator app</span>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-describedby="staff-code-help" required />
      </label>
    </AdminForm>
  );
}
