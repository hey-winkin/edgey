// The wire wordmark, from the master in assets/edgey-wire.svg. The sprite is
// rendered once in the root layout; every placement reuses it through #edgey
// so the mark inherits the surrounding ink colour.
const wireWidth = 400;
const wireHeight = 141;
const wireProjection = "matrix(1 -.022 -.105 1 16 17)";

export function WordmarkSprite() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
<path id="glyph-e" d="M64 56H19C21 65 27 70 36 70C44 70 50 67 55 62L64 72C57 81 47 85 35 85C15 85 2 71 2 52C2 32 16 18 35 18C54 18 65 32 65 51Z M19 44H48C46 36 41 32 34 32C27 32 21 36 19 44Z" fillRule="evenodd" clipRule="evenodd"/><path id="glyph-d" d="M48 0H65V83H49V76C44 82 37 85 28 85C12 85 1 71 1 52C1 32 13 18 30 18C38 18 44 21 48 26Z M48 51C48 40 42 33 33 33C24 33 18 40 18 52C18 63 24 70 33 70C42 70 48 63 48 51Z" fillRule="evenodd" clipRule="evenodd"/><path id="glyph-g" d="M49 20H65V76C65 97 53 109 33 109C21 109 11 105 4 98L13 87C19 92 25 95 33 95C44 95 49 89 49 78V75C44 81 38 84 30 84C13 84 1 71 1 52C1 32 13 18 30 18C38 18 44 21 49 27Z M49 51C49 40 43 33 33 33C24 33 18 40 18 52C18 62 24 69 33 69C43 69 49 62 49 51Z" fillRule="evenodd" clipRule="evenodd"/><path id="glyph-y" d="M0 20H18L35 63L51 20H69L41 88C34 105 28 110 14 110H7V95H12C18 95 22 92 25 85L26 82Z" fillRule="evenodd" clipRule="evenodd"/>
<g id="faces"><use href="#glyph-e" x="0"/><use href="#glyph-d" x="73"/><use href="#glyph-g" x="149"/><use href="#glyph-e" x="225"/><use href="#glyph-y" x="299"/></g>
<g id="rear"><use href="#faces" transform="translate(6 -8)"/><path d="M64 56l6 -8 M19 56l6 -8 M55 62l6 -8 M64 72l6 -8 M19 44l6 -8 M48 44l6 -8 M10 30l6 -8 M57 78l6 -8 M121 0l6 -8 M138 0l6 -8 M138 83l6 -8 M122 83l6 -8 M122 76l6 -8 M121 26l6 -8 M82 29l6 -8 M95 66l6 -8 M116 36l6 -8 M198 20l6 -8 M214 20l6 -8 M153 98l6 -8 M162 87l6 -8 M198 75l6 -8 M198 27l6 -8 M157 31l6 -8 M171 65l6 -8 M193 37l6 -8 M201 104l6 -8 M289 56l6 -8 M244 56l6 -8 M280 62l6 -8 M289 72l6 -8 M244 44l6 -8 M273 44l6 -8 M235 30l6 -8 M282 78l6 -8 M299 20l6 -8 M317 20l6 -8 M334 63l6 -8 M350 20l6 -8 M368 20l6 -8 M306 110l6 -8 M306 95l6 -8 M325 82l6 -8 M340 88l6 -8"/></g>
<mask id="outside" maskUnits="userSpaceOnUse" x="-12" y="-18" width="420" height="157"><rect x="-12" y="-18" width="420" height="157" fill="white"/><use href="#faces" fill="black"/></mask>
<mask id="inside" maskUnits="userSpaceOnUse" x="-12" y="-18" width="420" height="157"><use href="#faces" fill="white"/></mask>
<mask id="mast-proof-mask" maskContentUnits="objectBoundingBox">
 <use href="#faces" fill="white" transform={`scale(${1 / wireWidth} ${1 / wireHeight}) ${wireProjection}`}/>
</mask>
<g id="edgey" transform={wireProjection} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
 <g mask="url(#outside)"><use href="#rear" strokeWidth="2.7"/></g>
 <g mask="url(#inside)"><use href="#rear" strokeWidth="1.7" strokeDasharray="2.5 4.8" opacity=".80"/></g>
 <use href="#faces" strokeWidth="3.15"/>
</g></defs>
    </svg>
  );
}

export function Wordmark() {
  return (
    <svg className="wordmark" aria-hidden="true" viewBox={`0 0 ${wireWidth} ${wireHeight}`}>
      <use href="#edgey" />
    </svg>
  );
}
