import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { buildReferenceGuide } from "@/lib/catalogue/reference-guide";
import { listFamilies } from "@/lib/catalogue/server";
import { siteUrl } from "@/lib/catalogue/site-url";
import { ReferenceGuide } from "./reference-guide";
import styles from "./reference-guide.module.css";

const path = "/reference-guide";
const title = "Blade cross-reference guide";
const description = "Find published Edgey blades by machine brand, verified maker reference or Edgey code. Compare tool heads, angles, cutting depths and materials.";
const guideDate = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" });

export function generateMetadata(): Metadata {
  const url = siteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: "website", url },
  };
}

export default async function ReferenceGuidePage() {
  await connection();
  const groups = buildReferenceGuide(await listFamilies());
  const generatedAt = new Date();

  return (
    <main id="main-content" tabIndex={-1} className={`frame ${styles.page}`}>
      <nav className={`crumbs ${styles.screenOnly}`} aria-label="Breadcrumb">
        <Link href="/blades">Blade catalogue</Link>
      </nav>
      <p className={`kicker ${styles.screenOnly}`}><span className="register" aria-hidden="true" /> Catalogue guide</p>
      <h1>{title}</h1>
      <p className={styles.intro}>Match the code on your blade packet or look up a blade by machine brand. Open the blade page to check the exact fit and any adapter before ordering.</p>
      <p className={styles.note}>Only approved maker references are listed. Angles and cutting depths are catalogue figures and may come from unverified owner-supplied specifications. Unverified fit notes are omitted.</p>
      <ReferenceGuide groups={groups} url={siteUrl(path) ?? path} date={guideDate.format(generatedAt)} dateTime={generatedAt.toISOString()} />
    </main>
  );
}
