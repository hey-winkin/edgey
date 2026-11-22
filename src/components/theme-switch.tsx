"use client";

import { useSyncExternalStore } from "react";
import tokens from "../../design-tokens.json";

type Theme = "dark" | "light";
const getTheme = (): Theme => document.documentElement.dataset.theme === "light" ? "light" : "dark";
const getServerTheme = (): Theme => "dark";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  const target: Theme = theme === "dark" ? "light" : "dark";

  function toggle() {
    document.documentElement.dataset.theme = target;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tokens.themes[target].page);
    try {
      localStorage.setItem("edgey-theme", target);
    } catch {
    }
  }

  return (
    <button type="button" className="theme-switch" role="switch" aria-label="Light theme" aria-checked={theme === "light"}
      title="Toggle light theme" onClick={toggle}>
      <span className="theme-track" aria-hidden="true">
        <svg className="moon-symbol" viewBox="0 0 24 24">
          <path d="M19 15a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z" />
        </svg>
        <svg className="sun-symbol" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
        </svg>
      </span>
    </button>
  );
}
