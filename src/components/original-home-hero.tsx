import Link from "next/link";
import { FindBladeLink } from "./find-blade-link";
import { MaterialStudy } from "./material-study";

// Original homepage hero from the approved Edgey-preview.html, kept for reuse.
export function OriginalHomeHero() {
  return (
    <section className="hero frame" aria-labelledby="headline">
      <div className="hero-copy">
        <p className="kicker">
          <span className="register" aria-hidden="true" />
          Digital cutter tooling
        </p>
        <h1 id="headline">
          The cutting
          <br />
          room<span>.</span>
        </h1>
        <p className="intro">Replacement blades for digital cutters and plotters. Find the right tool for your print floor.</p>
        <div className="hero-actions">
          <FindBladeLink />
          <Link className="textlink" href="#materials">
            Browse materials
          </Link>
        </div>
      </div>
      <MaterialStudy />
    </section>
  );
}
