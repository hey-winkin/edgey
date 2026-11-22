"use client";

import { useEffect, useRef } from "react";

export function MastProofWash() {
  const wash = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const layer = wash.current;
    if (!layer) return;
    const syncVisibility = () => layer.toggleAttribute("data-visible", document.visibilityState === "visible");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  return <span className="mast-proof-wash" ref={wash} />;
}

const pauseKey = "edgey-logo-motion-paused";

export function MastProofControl() {
  const label = useRef<HTMLLabelElement>(null);
  const control = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!control.current || !label.current) return;
    try {
      control.current.checked = localStorage.getItem(pauseKey) === "true";
    } catch {}
    label.current.hidden = false;
  }, []);

  return (
    <label className="mast-proof-control" ref={label} hidden>
      <input type="checkbox" className="mast-proof-pause" ref={control} onChange={(event) => {
        try {
          localStorage.setItem(pauseKey, String(event.currentTarget.checked));
        } catch {}
      }} />
      Pause logo motion
    </label>
  );
}
