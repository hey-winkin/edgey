import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SkipLink } from "@/components/skip-link";
import { ThemeBootstrap } from "@/components/theme-bootstrap";
import { WordmarkSprite } from "@/components/wordmark";
import { indexableSiteOrigin } from "@/lib/catalogue/indexable-site";
import tokens from "../../design-tokens.json";
import "./globals.css";
import "./navigation.css";

export const metadata: Metadata = {
  title: { default: "Edgey — The cutting room", template: "%s | Edgey" },
  description:
    "Edgey’s digital cutting room. Explore replacement blades for print, packaging and display by tool type, material or part number.",
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
