import Link from "next/link";
import type { CSSProperties } from "react";
import { MastProofWash } from "./mast-proof";
import { Wordmark, mastProofMask } from "./wordmark";

export function MastHome({ staff = false }: { staff?: boolean }) {
  const label = staff ? "Staff desk" : "Edgey home";
  return (
    <Link className="mast-tool mast-home" href={staff ? "/admin" : "/"} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m3 10 9-7 9 7M5.5 9v11h13V9M10 20v-6h4v6" />
      </svg>
    </Link>
  );
}

export function MastMark({ staff = false }: { staff?: boolean }) {
  return (
    <span className="mast-mark" aria-hidden="true">
      {!staff && (
        <span className="mast-proof" style={{ "--mast-proof-mask": mastProofMask } as CSSProperties}>
          <MastProofWash />
        </span>
      )}
      <Wordmark />
      {staff && <span className="staff-identity">Staff</span>}
    </span>
  );
}
