"use client";

import { useEffect, useRef } from "react";

export function MastProof() {
  const wash = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const layer = wash.current;
    if (!layer) return;
    const syncVisibility = () => layer.toggleAttribute("data-visible", document.visibilityState === "visible");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  return (
    <span className="mast-proof">
      <span className="mast-proof-wash" ref={wash} />
    </span>
  );
}
