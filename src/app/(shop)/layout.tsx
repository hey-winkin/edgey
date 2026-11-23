import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Masthead } from "@/components/masthead";
import { SearchShortcut } from "@/components/search-shortcut";
import { SelectionDialog } from "@/components/selection-dialog";
import { SelectionProvider } from "@/components/selection-provider";
import { SiteFooter } from "@/components/site-footer";
import { siteDescription, siteTitle, socialMetadata } from "@/lib/catalogue/social";

export const metadata: Metadata = socialMetadata(siteTitle, siteDescription);

export default function ShopLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <SelectionProvider>
      <Masthead />
      {children}
      {modal}
      <SelectionDialog />
      <SiteFooter />
      <SearchShortcut />
    </SelectionProvider>
  );
}
