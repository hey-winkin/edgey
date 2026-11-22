import { redirect } from "next/navigation";
import { staffIdentity } from "@/lib/admin/auth";
import { signInStaff, signOutStaff } from "../session-actions";
import { AdminField, AdminForm, AdminHeading } from "../ui";
import { StaffAuthenticator } from "./staff-authenticator";

export const metadata = { title: "Staff sign-in" };

export default async function StaffSignIn() {
  const staff = await staffIdentity();
  if (staff?.steppedUp) redirect("/admin");
  if (staff?.sessionFactor) {
    return (
      <>
        <AdminHeading title="Staff sign-in" description="Your authenticator is verified, but not approved for staff access." />
        <div className="admin-panel admin-narrow">
          <p>Ask your Edgey administrator to approve your authenticator in person. Its ID is <code>{staff.sessionFactor}</code>.</p>
          <p>Reload this page once your administrator confirms approval.</p>
          <form action={signOutStaff} className="mt-3"><button className="admin-secondary">Sign out</button></form>
        </div>
      </>
    );
  }
  if (staff) {
    const { data, error } = await staff.db.auth.mfa.listFactors();
    const factors = data?.totp.filter(({ id }) => !staff.approvedFactor || id === staff.approvedFactor) ?? [];
    return (
      <>
        <AdminHeading title="Staff sign-in" description="Verify your authenticator before opening the staff desk." />
        <div className="admin-panel admin-narrow staff-sign-in-fields">
          {error || (staff.approvedFactor && !factors.length)
            ? <p role="alert">We couldn’t load your approved authenticator. Contact your Edgey administrator.</p>
            : <StaffAuthenticator factors={factors.map(({ id, friendly_name }) => ({ id, label: friendly_name }))} />}
          <form action={signOutStaff} className="mt-3"><button className="admin-secondary">Sign out</button></form>
        </div>
      </>
    );
  }
  return (
    <>
      <AdminHeading title="Staff sign-in" description="Use the account issued to you for Edgey operations." />
      <div className="admin-panel admin-narrow staff-sign-in-fields">
        <AdminForm action={signInStaff} submit="Sign in">
          <AdminField label="Work email"><input type="email" name="email" autoComplete="username" maxLength={254} required /></AdminField>
          <AdminField label="Password"><input type="password" name="password" autoComplete="current-password" maxLength={128} required /></AdminField>
        </AdminForm>
      </div>
    </>
  );
}
