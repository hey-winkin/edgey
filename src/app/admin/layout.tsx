import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { FoldNavigation } from "@/components/fold-navigation";
import { MastHome, MastMark } from "@/components/mast-brand";
import { ThemeSwitch } from "@/components/theme-switch";
import { staffSession } from "@/lib/admin/auth";
import { staffNavigation } from "@/lib/admin/navigation";
import { signOutStaff } from "./session-actions";
import "./admin.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const staff = await staffSession();

  return (
    <>
      <header className="mast staff-mast" aria-label="Edgey staff">
        <div className="frame nav-inner">
          <div className="mast-leading"><MastHome staff /></div>
          {staff ? (
            <FoldNavigation label="Edgey staff menu" mark={<MastMark staff />} title="Staff index" landmark="Staff areas" groups={staffNavigation(staff.roles)}>
              <form action={signOutStaff} className="fold-tools">
                <button type="submit" className="mast-tool">Sign out</button>
              </form>
            </FoldNavigation>
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
        {children}
      </main>
    </>
  );
}
