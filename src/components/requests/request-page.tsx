import type { ReactNode } from "react";
import { requestAvailability, requestsUnavailable } from "@/lib/requests/availability";
import styles from "./request.module.css";

export function RequestPage({
  overline,
  title,
  balanceTitle,
  intro,
  children,
}: {
  overline: string;
  title: string;
  balanceTitle?: boolean;
  intro: ReactNode;
  children: ReactNode;
}) {
  const availability = requestAvailability();
  return (
    <main id="main-content" tabIndex={-1} className="frame simple-page">
      <header className={styles.pageHeader}>
        <p className="kicker">
          <span className="register" aria-hidden="true" />
          {overline}
        </p>
        <h1 className={balanceTitle ? styles.balancedTitle : undefined}>{title}</h1>
        <p className="muted">{intro}</p>
      </header>
      {availability.enabled ? (
        <>
          {children}
          <p className={`muted ${styles.privacy}`}>
            We use the details you give us to process your request and reply.
            {"privacyUrl" in availability && <> <a className="textlink" href={availability.privacyUrl}>Privacy notice</a></>}
          </p>
        </>
      ) : <p role="status" className={styles.notice}>{requestsUnavailable}</p>}
    </main>
  );
}
