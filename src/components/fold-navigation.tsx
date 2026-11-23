"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

export type NavigationGroup = {
  title: string;
  links: { label: string; href: string }[];
  empty?: string;
};

export function FoldNavigation({
  label, mark, title, landmark, groups, currentLink, children,
}: {
  label: string;
  mark: ReactNode;
  title: string;
  landmark: string;
  groups: NavigationGroup[];
  currentLink?: { href: string; state: "page" | "location" } | null;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const menuDestination = useRef<string | null>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    if (previousPathname.current !== pathname) {
      if (menuDestination.current !== pathname && disclosure.current) disclosure.current.open = false;
      menuDestination.current = null;
    }
    previousPathname.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const details = disclosure.current;
    if (!details) return;
    const close = () => {
      const restore = details.open && details.contains(document.activeElement);
      details.open = false;
      if (restore) summary.current?.focus({ preventScroll: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !details.open) return;
      event.preventDefault();
      close();
    };
    const onOutside = (event: Event) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onOutside);
    document.addEventListener("pointerdown", onOutside);
    window.addEventListener("popstate", close);
    window.addEventListener("hashchange", close);
    window.addEventListener("pageshow", close);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("pointerdown", onOutside);
      window.removeEventListener("popstate", close);
      window.removeEventListener("hashchange", close);
      window.removeEventListener("pageshow", close);
    };
  }, []);

  return (
    <details className="fold" ref={disclosure}>
      <summary ref={summary} className="fold-toggle" aria-label={label} title={label}>
        {mark}
        <svg className="fold-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m2 4 4 4 4-4" />
        </svg>
      </summary>
      <div className="fold-backdrop" aria-hidden="true" onClick={() => {
        if (disclosure.current) disclosure.current.open = false;
        summary.current?.focus({ preventScroll: true });
      }} />
      <div className="fold-panel">
        <div className="frame fold-inner">
          <p className="kicker fold-index"><span className="register" aria-hidden="true" />{title}</p>
          <nav className="fold-groups" aria-label={landmark}>
            {groups.filter(({ links, empty }) => links.length || empty).map(({ title, links, empty }) => (
              <div className="fold-group" key={title}>
                <h2>{title}</h2>
                {links.length ? (
                  <ul>
                    {links.map(({ label, href }) => {
                      const current = currentLink !== undefined
                        ? currentLink?.href === href ? currentLink.state : undefined
                        : pathname === href ? "page" :
                          href !== "/admin" && pathname?.startsWith(href + "/") ? "location" : undefined;
                      return (
                        <li key={href}>
                          <Link href={href} prefetch={false} aria-current={current} onNavigate={() => {
                            const [destination, fragment] = href.split("#");
                            if (destination && destination !== pathname) menuDestination.current = destination;
                            if (disclosure.current) disclosure.current.open = false;
                            if (destination === pathname && fragment) {
                              const target = document.getElementById(fragment);
                              if (target) {
                                target.focus({ preventScroll: true });
                                return;
                              }
                            }
                            summary.current?.focus({ preventScroll: true });
                          }}>
                            {label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="fold-empty">{empty}</p>}
              </div>
            ))}
          </nav>
          {children}
        </div>
      </div>
    </details>
  );
}
