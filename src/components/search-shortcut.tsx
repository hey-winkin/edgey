"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function focusCatalogueSearch(scroll = true) {
  const finder = document.getElementById("finder");
  if (!finder) return false;
  if (scroll) {
    if (finder.closest("[data-search-first]")) finder.scrollIntoView({ block: "center" });
    else document.getElementById("catalogue")?.scrollIntoView();
  }
  finder.focus({ preventScroll: true });
  return true;
}

export function SearchShortcut() {
  const router = useRouter();
  const pathname = usePathname();
  const focusOnRoute = useRef(false);
  useEffect(() => {
    if (pathname === "/blades" && (focusOnRoute.current || window.location.hash === "#finder")) {
      focusCatalogueSearch(focusOnRoute.current);
      focusOnRoute.current = false;
    }
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector("dialog[open], .fold[open]")) return;
      if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      if (!focusCatalogueSearch()) {
        focusOnRoute.current = true;
        router.push("/blades", { scroll: false });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);
  return null;
}
