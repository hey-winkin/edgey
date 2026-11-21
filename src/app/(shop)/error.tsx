"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function StorefrontError({ reset }: { reset: () => void }) {
  const path = usePathname();
  const id = path === "/" || path === "/blades" ? "catalogue" : "main-content";
  return (
    <main id={id} tabIndex={-1} className="frame simple-page">
      <p className="kicker"><span className="register" aria-hidden="true" />Catalogue unavailable</p>
      <h1>We couldn’t load the blades</h1>
      <p>The catalogue didn’t respond. Try again in a moment.</p>
      <div className="empty-actions">
        <button className="primary" type="button" onClick={reset}>Try again</button>
        <Link className="textlink" href="/#catalogue">Back to the catalogue</Link>
      </div>
    </main>
  );
}
