import Link from "next/link";
import { connection } from "next/server";
import { brandHref } from "@/lib/catalogue";
import { getNavigationBrands } from "@/lib/catalogue/navigation-brands";
import { FoldNavigation } from "./fold-navigation";
import { MastSearch } from "./mast-search";
import { SelectionTrigger } from "./selection-dialog";
import { ThemeSwitch } from "./theme-switch";
import { Wordmark } from "./wordmark";

export async function Masthead() {
  await connection();
  const brands = await getNavigationBrands();

  return (
    <header className="mast shop-mast">
      <div className="frame nav-inner">
        <Link className="brand" href="/" aria-label="Edgey home">
          <Wordmark />
        </Link>
        <FoldNavigation label="Menu" title="Shop index" landmark="Shop navigation" groups={[
          { title: "Find a blade", links: [
            { label: "Search by part number", href: "/blades#finder" },
            { label: "By material", href: "/blades#materials" },
            { label: "All blades", href: "/blades" },
          ] },
          { title: "By machine", links: (brands ?? []).map(({ name, slug }) => ({ label: name, href: brandHref(slug) })),
            empty: brands ? "No machine pages are listed yet. Try searching by part number." :
              "Machine links are temporarily unavailable. Try searching by part number." },
          { title: "Buying", links: [
            { label: "Trade accounts", href: "/trade" },
            { label: "Two-blade trial", href: "/sample-pack" },
          ] },
          { title: "Help & account", links: [
            { label: "Match my blade", href: "/enquiry" },
            { label: "Contact", href: "/contact" },
            { label: "Account", href: "/account" },
            { label: "Privacy", href: "/privacy" },
          ] },
        ]}>
          <div className="fold-tools shop-compact-theme">
            <ThemeSwitch />
          </div>
        </FoldNavigation>
        <div className="nav-tools">
          <div className="shop-wide-theme"><ThemeSwitch /></div>
          <MastSearch />
          <SelectionTrigger />
        </div>
      </div>
    </header>
  );
}
