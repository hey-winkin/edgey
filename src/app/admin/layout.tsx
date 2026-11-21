import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { FoldNavigation } from "@/components/fold-navigation";
import { ThemeSwitch } from "@/components/theme-switch";
import { Wordmark } from "@/components/wordmark";
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
          <Link className="brand" href={staff ? "/admin" : "/admin/sign-in"} aria-label={staff ? "Edgey staff desk" : "Edgey staff sign-in"}>
            <Wordmark />
            <span className="staff-identity">Staff</span>
          </Link>
          {staff && (
            <FoldNavigation label="Staff menu" title="Staff index" landmark="Staff areas" groups={staffNavigation(staff.roles)}>
              <form action={signOutStaff} className="fold-tools">
                <button type="submit" className="mast-tool">Sign out</button>
              </form>
            </FoldNavigation>
          )}
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
