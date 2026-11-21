import type { Metadata } from "next";
import { headers } from "next/headers";
import { finderAttributionAllowed, finderAttributionEnabled } from "@/lib/commercial/privacy";
import { publicPrivacyNotice } from "@/lib/requests/public-information";
import { setFinderAttributionPreference } from "./actions";

export const metadata: Metadata = { title: "Privacy", robots: { index: false, follow: true } };
export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const notice = publicPrivacyNotice({ pathname: "/privacy", host: (await headers()).get("host") });
  const canChoose = finderAttributionEnabled();
  const optedIn = await finderAttributionAllowed();
  return (
    <main id="main-content" tabIndex={-1} className="frame simple-page">
      <p className="kicker"><span className="register" aria-hidden="true" /> Edgey</p>
      <h1>Privacy</h1>
      {notice ? <p><a className="textlink" href={notice}>Read the Edgey privacy notice</a></p>
        : <p className="muted">The privacy notice hasn’t been published on this site yet.</p>}
      <section className="mt-6">
        <h2>Optional Finder analytics</h2>
        <p className="muted">Edgey counts search outcomes without linking them to orders unless you opt in.</p>
        <p className="muted">If switched on, this browser stores a random identifier for up to 30 minutes after an exact blade search. It helps Edgey measure whether that search led to an order for a matching blade. Search attribution does not record your email, IP address or free text.</p>
        <p className="muted">{canChoose
          ? "It’s off unless you turn it on. Your choice lasts for this browser session and you can turn it off here at any time. Your choice does not affect checkout."
          : "This site does not set the optional Finder attribution cookie."}</p>
        {canChoose && <form action={setFinderAttributionPreference.bind(null, !optedIn)}>
          <button type="submit" className="textlink">{optedIn ? "Turn off Finder analytics" : "Turn on Finder analytics"}</button>
        </form>}
      </section>
    </main>
  );
}
