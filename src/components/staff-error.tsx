import Link from "next/link";

export function StaffError({ reset }: { reset: () => void }) {
  return (
    <>
      <h1 className="page-title">We couldn’t open the staff area</h1>
      <p>Try again in a moment, or return to the staff desk.</p>
      <div className="empty-actions">
        <button className="primary" type="button" onClick={reset}>Try again</button>
        <Link className="textlink" href="/admin">Staff desk</Link>
        <Link className="textlink" href="/">View shop</Link>
      </div>
    </>
  );
}
