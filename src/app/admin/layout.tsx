import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { MastMark } from "@/components/mast-brand";
import { ThemeSwitch } from "@/components/theme-switch";
import { staffSession } from "@/lib/admin/auth";
import { staffNavigation } from "@/lib/admin/navigation";
import { signOutStaff } from "./session-actions";
import { StaffHome, StaffLocation, StaffMenu } from "./staff-navigation";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await staffSession();
  const groups = staff ? staffNavigation(staff.roles) : null;

  return (
    <>
      <header className="mast staff-mast" aria-label="Edgey staff">
        <div className="frame nav-inner">
          <div className="mast-leading"><StaffHome /></div>
          {groups ? (
            <StaffMenu groups={groups} mark={<MastMark staff />}>
              <form action={signOutStaff} className="fold-tools">
                <button type="submit" className="mast-tool">Sign out</button>
              </form>
            </StaffMenu>
          ) : <div className="mast-brand-static"><MastMark staff /></div>}
          <div className="nav-tools">
            <ThemeSwitch />
            <Link className="mast-tool" href="/" prefetch={false} aria-label="View shop">
              <span className="staff-shop-prefix">View </span>shop
            </Link>
          </div>
        </div>
      </header>
      <main className="admin frame" id="main-content" tabIndex={-1}>
        {groups && <StaffLocation groups={groups} />}
        {children}
      </main>
    </>
  );
}
