"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { FoldNavigation } from "@/components/fold-navigation";
import { MastHome } from "@/components/mast-brand";
import { staffLocation, type staffNavigation } from "@/lib/admin/navigation";

type StaffGroups = ReturnType<typeof staffNavigation>;

export function StaffHome() {
  return <MastHome staff current={usePathname() === "/admin"} />;
}

export function StaffMenu({ groups, mark, children }: { groups: StaffGroups; mark: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  return (
    <FoldNavigation label="Edgey staff menu" mark={mark} title="Staff index" landmark="Staff areas"
      groups={groups} currentLink={staffLocation(groups, pathname, view)}>
      {children}
    </FoldNavigation>
  );
}

export function StaffLocation({ groups }: { groups: StaffGroups }) {
  const location = staffLocation(groups, usePathname(), null);
  return location && <p className="eyebrow admin-location">{location.title}</p>;
}
