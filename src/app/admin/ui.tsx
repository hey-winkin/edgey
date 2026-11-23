import Link from "next/link";
import type { ReactNode } from "react";

export { AdminForm } from "./form";

const areaEyebrows = new Set(["Edgey operations", "Warehouse", "Warehouse / Stock", "Warehouse / Delivery record", "Requests"]);

export function AdminHeading({ title, eyebrow = "Edgey operations", description }: {
  title: string;
  eyebrow?: string;
  description?: string;
}) {
  return (
    <header className="admin-heading">
      <p className="eyebrow" data-area-eyebrow={areaEyebrows.has(eyebrow) || undefined}>{eyebrow}</p>
      <h1>{title}</h1>
      {description && <p className="admin-muted">{description}</p>}
    </header>
  );
}

export function AdminSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="admin-section"><h2>{title}</h2>{children}</section>;
}

export function AdminTable({ headers, label, children }: {
  headers: string[];
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="admin-table" aria-label={label}>
        <thead><tr>{headers.map((header) => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function AdminField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="admin-field"><span>{label}</span>{children}</label>;
}

export function AdminNotice({ children }: { children: ReactNode }) {
  return <p className="admin-notice">{children}</p>;
}

export function AdminLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="textlink" prefetch={false}>{children}</Link>;
}
