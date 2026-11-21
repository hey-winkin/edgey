"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

// The approved product dialog, opened over the catalogue while the address is
// /blades/[slug]. Closing it goes back, so Back closes it too.
export function ProductDialog({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement;
    if (element && !element.open) element.showModal();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) {
        requestAnimationFrame(() => opener.focus({ preventScroll: true }));
      }
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="product-dialog"
      aria-labelledby="detail-title"
      onPointerDown={(event) => {
        backdropDown.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropDown.current && event.target === event.currentTarget) event.currentTarget.close();
        backdropDown.current = false;
      }}
      onClose={() => router.back()}
    >
      <div className="dialog-wrap">
        <div className="dialog-heading">
          <button className="x-close" aria-label="Close blade details" type="button" onClick={() => dialog.current?.close()}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
