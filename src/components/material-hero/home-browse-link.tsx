"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function HomeBrowseLink({ href, current, scroll = false, className, children }: {
  href: string;
  current?: boolean;
  scroll?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      aria-current={current ? "true" : undefined}
      prefetch={false}
      scroll={scroll}
      onNavigate={() => {
        const form = document.getElementById("catalogue-controls");
        if (form instanceof HTMLFormElement) form.reset();
      }}
    >
      {children}
    </Link>
  );
}
