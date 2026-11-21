import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="frame simple-page">
      <p className="kicker">
        <span className="register" aria-hidden="true" />
        Not found
      </p>
      <h1>We could not find that page</h1>
      <p>The blade may not be published yet, or the address may be mistyped.</p>
      <div className="empty-actions">
        <Link className="primary" href="/blades">
          Browse the catalogue
        </Link>
        <Link className="textlink" href="/enquiry">
          Ask us to match a blade
        </Link>
      </div>
    </main>
  );
}
