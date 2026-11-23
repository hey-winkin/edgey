import styles from "./material-art.module.css";

export const annotationTags = {
  length: "A",
  depth: "B",
  thickness: "C",
  angle: "D",
  motion: "E",
  range: "F",
  diameter: "G",
  shank: "H",
  width: "I",
  bore: "J",
} as const;

type Annotations = Partial<Record<keyof typeof annotationTags, string>>;

const compactCallouts = [
  { key: "length", x: 208, y: 53, line: "M223 53h27m36-11h-36v157h49m-52-154 6-6m-6 163 6-6" },
  { key: "depth", x: 410, y: 265, line: "m312 199 67 66h16" },
  { key: "thickness", x: 382, y: 39, line: "m320.4 66 27-27H367" },
  { key: "angle", x: 394, y: 98, line: "m301.8 163.3 61-65.3H379" },
  { key: "motion", x: 208, y: 114, line: "M223 114h34" },
  { key: "range", x: 82, y: 286, line: "m211 252-50 34H97" },
] as const;

function FlutedEdge({ count }: { count: number }) {
  const width = count * 20;

  return (
    <g>
      <path d={`M0 0h${width}v26H0z`} fill="var(--core)" stroke="var(--contour)" />
      {Array.from({ length: count }, (_, index) => (
        <g key={index} transform={`translate(${index * 20})`}>
          <path d="M0 3C4.6 3 5.4 23 10 23S15.4 3 20 3L16 3C12 4 11 18 8 18S4 6 0 4Z" fill="var(--ridge)" opacity=".65" />
          <path d="M0 3C4.6 3 5.4 23 10 23S15.4 3 20 3" fill="none" stroke="var(--liner)" strokeWidth="2.7" />
          <path d="M0 2.4C4.6 2.4 5.4 22.4 10 22.4S15.4 2.4 20 2.4" fill="none" stroke="var(--contour)" strokeWidth=".8" />
        </g>
      ))}
      <path d={`M0 0h${width}v2.4H0zM0 23.8h${width}V26H0z`} fill="var(--liner)" stroke="var(--contour)" strokeWidth=".8" />
    </g>
  );
}

export function CorrugatedDrawing({ annotations }: { annotations: Annotations }) {
  return (
    <svg className={styles.drawing} viewBox="0 0 620 314" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--ridge)" strokeWidth=".85">
        <path d="M10 19v-9h9m582 0h9v9M10 295v9h9m582 0h9v-9" />
        <path d="M35 255 584 123M309 13v277" opacity=".55" strokeDasharray="13 4 2 4" />
      </g>

      <g stroke="var(--contour)" strokeWidth="1.15">
        <path d="m70 215 58 47v26l-58-47z" fill="var(--liner)" />
        <path d="m71 217 57 47m-57-25 57 47" fill="none" stroke="var(--core)" />
        <path d="m71 224 57 47" fill="none" stroke="var(--ridge)" opacity=".65" />
        <path d="M97.5 237.3v25.4l3.3 2.7v-25.6" fill="var(--core)" />
        <g transform="matrix(1 -.24 0 1 279 195.3)">
          <FlutedEdge count={4} />
        </g>
        <path d="m359 176.1 29 23.5v26l-29-23.5z" fill="var(--liner)" />
        <path d="m359 178.5 29 23.5m-29-1.9 29 23.5" stroke="var(--core)" fill="none" />
        <g transform="matrix(1 -.24 0 1 128 262)">
          <FlutedEdge count={9} />
          <g transform="translate(260)">
            <FlutedEdge count={8} />
          </g>
        </g>
        <g transform="matrix(1 -.24 .90625 .734375 70 215)">
          <path d="M0 0h420v64H260V32h-80v32H0z" fill="var(--paper)" />
          <g fill="var(--core)" stroke="none" opacity=".24">
            <path d="m365 0-38 64h21l38-64zm29 0-38 64h4l38-64z" />
            <path d="m401 0-38 64h2l38-64z" />
          </g>
          <g fill="none" stroke="var(--liner)" strokeWidth=".85">
            <path d="M9 9h101m6 0h18m58 6h69m32 40h23M9 54h24m4 0h22m341-45h12" />
          </g>
          <path d="M0 30.4 213 32H180L0 34Z" fill="var(--core)" stroke="var(--core)" />
          <path d="m0 34 180-2" fill="none" stroke="var(--contour)" strokeWidth="1.1" />
        </g>
      </g>

      <g transform="matrix(0 -.8 .95 -.24 309 114)" stroke="var(--contour)" strokeWidth="1.2">
        <path d="M-107 3 -57-15h35l7-9H87l8 6v28H0l-9-7Z" fill="var(--metal)" />
        <path d="m-107 3 52-11h36l10 11Z" fill="var(--metal-edge)" stroke="var(--metal-edge)" />
        <path d="M-107 3H-9l9 7h95l-3 4H-2l-10-7h-95Z" fill="var(--metal-edge)" />
        <path d="M12-16h34a4 4 0 0 1 0 8H12a4 4 0 0 1 0-8Z" fill="var(--edgey-drawing-plate)" stroke="var(--metal-edge)" />
        <path d="M12-9.3h34m-59-11h93" fill="none" stroke="var(--metal-edge)" strokeWidth="1" />
      </g>

      {annotations.motion && (
        <path d="M264 100v27m-4-22 4-5 4 5m-8 17 4 5 4-5" stroke="var(--contour)" strokeWidth="1.5" fill="none" />
      )}
      <g className={styles.leader}>
        {annotations.length && (
          <g>
            <path d="M286 42h-41m55 157h-55m5-157v157m-3-154 6-6m-6 163 6-6M250 73h-37l-9-9H25" />
            <text x="25" y="57">{annotations.length}</text>
          </g>
        )}
        {annotations.motion && (
          <g>
            <path d="M258 114h-47l-13 13H25" />
            <text x="25" y="120">{annotations.motion}</text>
          </g>
        )}
        {annotations.thickness && (
          <g>
            <path d="m320.4 66 32-31H595" />
            <circle cx="320.4" cy="66" r="2.5" />
            <text x="595" y="28" textAnchor="end">{annotations.thickness}</text>
          </g>
        )}
        {annotations.angle && (
          <g>
            <path d="m301.8 163.3 63-65H595" />
            <circle cx="301.8" cy="163.3" r="2.5" />
            <text x="595" y="91" textAnchor="end">{annotations.angle}</text>
          </g>
        )}
        {annotations.depth && (
          <g>
            <path d="m312 199 100 68H595" />
            <circle cx="312" cy="199" r="2.5" />
            <text x="595" y="260" textAnchor="end">{annotations.depth}</text>
          </g>
        )}
        {annotations.range && (
          <g>
            <path d="m211 252-52 46H25" />
            <circle cx="211" cy="252" r="2.5" />
            <text x="25" y="291">{annotations.range}</text>
          </g>
        )}
      </g>
      <g className={styles.compactLeaders}>
        {compactCallouts.map(({ key, x, y, line }) => annotations[key] && (
          <g key={key}>
            <path d={line} />
            <rect x={x - 15} y={y - 15} width="30" height="30" />
            <text x={x} y={y} dy=".35em" textAnchor="middle">{annotationTags[key]}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function CorrugatedSwatch() {
  return (
    <svg className={styles.swatch} viewBox="0 0 134 74" aria-hidden="true" focusable="false">
      <g transform="matrix(.89 -.2 0 .75 22 45)">
        <path d="m-17-20 17 20v26L-17 6z" fill="var(--liner)" stroke="var(--contour)" />
        <path d="m-17-17 17 20M-17 3 0 23" fill="none" stroke="var(--core)" strokeWidth=".9" />
        <FlutedEdge count={6} />
        <path d="M0 0-17-20h120L120 0Z" fill="var(--paper)" stroke="var(--contour)" strokeWidth=".95" />
        <path d="M78-20H68l5 20h10zm8 0h-3l5 20h3z" fill="var(--core)" opacity=".24" />
        <path d="M-8-15H8m9 11h36" fill="none" stroke="var(--liner)" strokeWidth=".8" />
      </g>
    </svg>
  );
}

export function MaterialPlaceholderSwatch() {
  return (
    <svg className={styles.swatch} viewBox="0 0 106 62" aria-hidden="true" focusable="false">
      <path d="M7 17V8h9m74 0h9v9M7 45v9h9m74 0h9v-9" fill="none" stroke="var(--ridge)" />
      <path d="M46 31h14m-7-7v14" fill="none" stroke="var(--ridge)" />
    </svg>
  );
}
