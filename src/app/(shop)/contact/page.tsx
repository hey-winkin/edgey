import type { Metadata } from "next";
import Link from "next/link";
import { requestAvailability } from "@/lib/requests/availability";
import { publicContactEmail } from "@/lib/requests/public-information";

export const metadata: Metadata = { title: "Contact", robots: { index: false, follow: true } };
export const dynamic = "force-dynamic";

export default function ContactPage() {
  const email = publicContactEmail();
  const enquiriesOpen = requestAvailability().enabled;
  return (
    <main id="main-content" tabIndex={-1} className="frame simple-page">
      <p className="kicker"><span className="register" aria-hidden="true" /> Edgey</p>
      <h1>Contact</h1>
      {email && <p>Business enquiries: <a className="textlink" href={`mailto:${email}`}>{email}</a></p>}
      {enquiriesOpen && <p><Link className="textlink" href="/enquiry">Open an enquiry</Link> about compatibility or delivery.</p>}
      {!email && !enquiriesOpen && <p className="muted">Public contact details aren’t available on this site yet.</p>}
    </main>
  );
}
