"use client";

import { usePathname } from "next/navigation";
import { StaffError } from "@/components/staff-error";
import StorefrontError from "./(shop)/error";

export default function AppError({ reset }: { reset: () => void }) {
  const path = usePathname();
  return path === "/admin" || path?.startsWith("/admin/") ? (
    <main className="frame simple-page" id="main-content" tabIndex={-1}><StaffError reset={reset} /></main>
  ) : <StorefrontError reset={reset} />;
}
