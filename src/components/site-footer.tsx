import Link from "next/link";
import { Wordmark } from "./wordmark";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="frame footer-proof">
        <Link href="#top" className="proof-wordmark" aria-label="Edgey back to top">
          <Wordmark />
        </Link>
      </div>
      <div className="frame foot-inner">
        <p>Staging catalogue · Test data · UK trade pricing ex VAT</p>
        <nav aria-label="Footer">
          <Link className="textlink" href="/contact">Contact</Link>
          <Link className="textlink" href="/privacy">Privacy</Link>
          <Link className="textlink" href="#top">Back to top</Link>
        </nav>
      </div>
    </footer>
  );
}
