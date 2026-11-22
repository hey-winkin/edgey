"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusCatalogueSearch } from "./search-shortcut";

export function MastSearch() {
  const pathname = usePathname();

  return (
    <Link className="mast-tool mast-search" href="/blades#finder" prefetch={false} aria-label="Search blades" title="Search blades"
      onNavigate={() => { if (pathname === "/blades") focusCatalogueSearch(false); }}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.25" /><path d="m15 15 4.5 4.5" /></svg>
    </Link>
  );
}
