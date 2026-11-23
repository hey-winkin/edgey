import Link from "next/link";
import { Fragment } from "react";
import { JsonLd } from "@/components/json-ld";
import { siteUrl } from "@/lib/catalogue/site-url";

export const catalogueCrumb = { href: "/blades", label: "Blade catalogue" };

export function Breadcrumbs({ items }: { items: ReadonlyArray<{ href: string; label: string }> }) {
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        {items.map(({ href, label }, index) => (
          <Fragment key={href}>
            {index > 0 && <span aria-hidden="true">/</span>}
            {index === items.length - 1
              ? <span aria-current="page">{label}</span>
              : <Link href={href}>{label}</Link>}
          </Fragment>
        ))}
      </nav>
      <JsonLd data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map(({ href, label }, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: label,
          item: siteUrl(href) ?? href,
        })),
      }} />
    </>
  );
}
