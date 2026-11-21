import Link from "next/link";

export default function StaffNotFound() {
  return (
    <>
      <h1 className="page-title">We could not find that page</h1>
      <p>The address may be mistyped or the record may no longer be available.</p>
      <Link className="textlink" href="/admin">Back to the staff desk</Link>
    </>
  );
}
