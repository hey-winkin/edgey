import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SkipLink } from "@/components/skip-link";
import { ThemeBootstrap } from "@/components/theme-bootstrap";
import { WordmarkSprite } from "@/components/wordmark";
import { indexableSiteOrigin } from "@/lib/catalogue/indexable-site";
import { siteUrl } from "@/lib/catalogue/site-url";
import { siteDescription, siteTitle } from "@/lib/catalogue/social";
import tokens from "../../design-tokens.json";
import "./globals.css";
import "./navigation.css";

const origin = siteUrl("/");

export const metadata: Metadata = {
  metadataBase: origin ? new URL(origin) : undefined,
  title: { default: siteTitle, template: "%s | Edgey" },
  description: siteDescription,
  robots: indexableSiteOrigin() ? undefined : { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" data-theme={tokens.defaultState.theme} suppressHydrationWarning>
      <body id="top">
        <ThemeBootstrap />
        <WordmarkSprite />
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
