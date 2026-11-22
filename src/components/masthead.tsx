import { connection } from "next/server";
import { brandHref } from "@/lib/catalogue";
import { getNavigationBrands } from "@/lib/catalogue/navigation-brands";
import { FoldNavigation } from "./fold-navigation";
import { MastHome, MastMark } from "./mast-brand";
import { MastSearch } from "./mast-search";
import { SelectionTrigger } from "./selection-dialog";
import { ThemeSwitch } from "./theme-switch";

export async function Masthead() {
  await connection();
  const brands = await getNavigationBrands();

  return (
    <header className="mast shop-mast">
      <div className="frame nav-inner">
        <div className="mast-leading">
          <MastHome />
          <MastSearch />
        </div>
        <FoldNavigation label="Edgey shop menu" mark={<MastMark />} title="Shop index" landmark="Shop navigation" groups={[
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
        ]} />
        <div className="nav-tools">
          <ThemeSwitch />
          <SelectionTrigger />
        </div>
      </div>
    </header>
  );
}
