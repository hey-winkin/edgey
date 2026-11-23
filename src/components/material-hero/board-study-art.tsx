import { useId } from "react";
import type { StudyArtProps, StudyIllustration } from "./extended-material-art";

function FoamBoard({ annotations }: StudyArtProps) {
  const pore = useId();
  const section = `url(#${pore})`;
  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <pattern id={pore} patternUnits="userSpaceOnUse" width="31" height="18">
          <rect width="31" height="18" fill="var(--foam-edge)" stroke="none" />
          <g fill="none" stroke="var(--foam)" strokeWidth=".85">
            <path d="m2 5 2-1.7 2.3.7.5 1.9-1.5 1.3-2.7-.6zm13-1.3 2-.7 1.2 1.2-.5 1.4-1.9.4zm6.8 8 2.6-1.4 2.1 1.3-.7 2.1-2.1.5zM9 13.5l1.5-1.2 1.8.5" />
          </g>
          <path d="m1 13 1.3-.5m11-5 1.4.4m4 7.3 1.2.3m7-12 1.4-1" stroke="var(--cavity)" strokeWidth=".8" opacity=".55" />
          <path d="m2 5 2-1.7 2.3.7m15.5 7.7 2.6-1.4" fill="none" stroke="var(--ridge)" strokeWidth=".8" opacity=".72" />
        </pattern>
      </defs>
      <g transform="matrix(1 -.24 0 1 128 262)">
        <path d="M0 0-58-61v22L0 22Z" fill={section} />
        <path d="M0 0-58-61v2.7L0 2.7ZM0 19.3-58-41.7v2.7L0 22Z" fill="var(--foam)" strokeWidth=".8" />
        <path d="M-31-32.6v14.4l3 1.8v-13.2" fill="var(--cavity)" stroke="none" />
        <path d="M152-30.5h80v22h-80z" fill={section} />
        <path d="M152-30.5h80v2.7h-80zm0 19.3h80v2.7h-80z" fill="var(--foam)" strokeWidth=".85" />
        <path d="m232-30.5 29 30.5v22l-29-30.5z" fill={section} />
        <path d="m232-28 29 30.5m-29-14 29 30.5" fill="none" stroke="var(--foam)" strokeWidth=".85" />
        <path d="M0 0h181v22H0zM261 0h159v22H261z" fill={section} />
        <path d="M0 0h181v2.7H0zM261 0h159v2.7H261zM0 19.3h181V22H0zM261 19.3h159V22H261z" fill="var(--foam)" strokeWidth=".85" />
        <g transform="matrix(1 0 .95 1 0 0)">
          <path d="M0-61h420V0H261v-30.5h-80V0H0Z" fill="var(--foam)" />
          <path d="M11-53h60m6 0h10m249 8h37m-302 32h20m198-3h37m40-39h27" fill="none" stroke="var(--foam-edge)" strokeWidth=".8" />
          <path d="m0-32 212 1.5-31 .7L0-29Z" fill="var(--cavity)" stroke="var(--ridge)" strokeWidth=".8" />
        </g>
      </g>
      <g transform="matrix(0 -.8 .95 -.24 309 114)" strokeWidth="1.2">
        <path d="M-107 3 -57-15h35l7-9H87l8 6v28H0l-9-7Z" fill="var(--metal)" />
        <path d="m-107 3 52-11h36l10 11Z" fill="var(--metal-edge)" stroke="var(--metal-edge)" />
        <path d="M-107 3H-9l9 7h95l-3 4H-2l-10-7h-95Z" fill="var(--metal-edge)" />
        <path d="M12-16h34a4 4 0 0 1 0 8H12a4 4 0 0 1 0-8Z" fill="var(--edgey-drawing-plate)" stroke="var(--metal-edge)" />
        <path d="M12-9.3h34m-59-11h93" fill="none" stroke="var(--metal-edge)" strokeWidth=".9" />
      </g>
      <g fill="none" strokeWidth=".9">
        {annotations.length && <path d="M282 42h-36m55 157h-55m5-157v157m-3-154 6-6m-6 163 6-6" stroke="var(--ridge)" />}
        {annotations.motion && <path d="M266 105v25m-4-20 4-5 4 5m-8 15 4 5 4-5" />}
      </g>
    </g>
  );
}

function CellularBoard({ honeycomb, annotations }: StudyArtProps & { honeycomb: boolean }) {
  const id = useId();
  const cells = `url(#${id}-cells)`;
  const edge = `url(#${id}-edge)`;
  const face = honeycomb ? "var(--foam)" : "var(--paper)";
  const interior = "color-mix(in srgb, var(--cavity) 83%, var(--core))";
  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <pattern id={id + "-cells"} width={honeycomb ? 36 : 16} height={honeycomb ? 21 : 13} patternUnits="userSpaceOnUse">
          {honeycomb ? <>
            <rect width="36" height="21" fill={interior} stroke="none" />
            {[[0, 0], [36, 0], [18, 10.5], [0, 21], [36, 21]].map(([x, y]) => (
              <g key={x + ":" + y} transform={`translate(${x} ${y})`}>
                <path d="M-12 0-6-10.5H6L12 0H9.5L4-7.5h-8L-9 1Z" fill="var(--liner)" stroke="none" />
                <path d="m-12 0 6-10.5H6L12 0 6 10.5H-6Z" fill="none" stroke="var(--paper)" strokeWidth=".85" />
              </g>
            ))}
          </> : <>
            <rect width="16" height="13" fill={interior} stroke="none" />
            <path d="M0 1h16M0 7.5h16M0 1q4 0 6 4.5t6 0Q14 1 16 1M-8 7.5q4 0 6 4.5t6 0q2-4.5 4-4.5t6 4.5l2 1.1" fill="none" stroke="var(--liner)" strokeWidth="1.55" />
            <path d="M0 1h16M0 7.5h16" stroke="var(--paper)" strokeWidth=".8" />
          </>}
        </pattern>
        <pattern id={id + "-edge"} width={honeycomb ? 36 : 15} height="36" patternUnits="userSpaceOnUse">
          <rect width={honeycomb ? 36 : 15} height="36" fill={interior} stroke="none" />
          {honeycomb ? <>
            <path d="M2 1 11 7v29l-9-5Zm28 6 6-6v30l-6 5Z" fill="var(--liner)" opacity=".72" stroke="none" />
            <path d="M2 34V1l9 6h19l6-6M11 7v28M30 7v28" fill="none" stroke="var(--liner)" strokeWidth=".85" />
          </> : <>
            <path d="m1 1 3 4v31l-3-4Zm9 4 3-4v31l-3 4Z" fill="var(--liner)" stroke="none" />
            <path d="M1 35V1m9 34V5l3-4" fill="none" stroke="var(--paper)" strokeWidth=".8" />
          </>}
        </pattern>
      </defs>
      <g transform="matrix(1 -.24 0 1 128 262)">
        <path d="M0 0-58-61v33L0 33Z" fill="var(--liner)" />
        <path d="m-58-58 58 61m-58-34 58 61" fill="none" stroke="var(--core)" strokeWidth=".85" />
        <path d="M0 0h168l42 27 27-27h183v33H0Z" fill={edge} />
        <path d="M0 30.4h420V33H0Z" fill={face} strokeWidth=".85" />
        <path d={honeycomb ? "M0 0h168l4.2 2.7H0zM237 0h55v2.7h-57.7z" : "M108 0h60l4.2 2.7H108zM237 0h183v2.7H234.3z"} fill={face} strokeWidth=".85" />
        <path d="M168 0 110-61l42 27L210 27Z" fill="var(--liner)" />
        <path d="M210 27 152-34l27-27L237 0Z" fill="var(--liner)" />
        <g transform="matrix(1 -1 .95 1 210 27)">
          <path d="M0 0h27v-61H0Z" fill={cells} strokeWidth=".8" />
          <path d="M24.3 0H27v-61h-2.7z" fill={face} strokeWidth=".8" />
        </g>
        <g transform="matrix(1 0 .95 1 0 0)">
          <path d={honeycomb ? "M292-29H420V0H292Z" : "M0-21H108V0H0Z"} fill={cells} />
          <path d={honeycomb ? "M0-61h168V0H0ZM237-61h183v32H292V0h-55Z" : "M0-61h168V0h-60v-21H0ZM237-61h183V0H237Z"} fill={face} />
          <path d={honeycomb ? "M292-29v2h128v-2ZM292 0v-27" : "M0-21h108v2H0ZM108 0v-19"} fill="var(--liner)" strokeWidth=".8" />
          <path d="M12-52h61m6 0h19m38 38h20m100-35h35m63 4h36" fill="none" stroke={honeycomb ? "var(--foam-edge)" : "var(--liner)"} strokeWidth=".85" />
        </g>
      </g>
      <g transform="matrix(.49 -.79 .82 .42 347 130)" strokeWidth="1.2">
        <path d="M-100 14-73-16H99v31l-3 4h-198Z" fill="var(--metal-edge)" />
        <path d="M-100 14-73-16H99v30Z" fill="var(--metal)" />
        <path d="m-100 14 7-8H49q4 0 4 3v5Z" fill="var(--metal-edge)" strokeWidth=".85" />
        <path d="M53 14H99l-3 5M-102 19l2-5m27-25H91" stroke="var(--metal-edge)" fill="none" strokeWidth=".85" />
      </g>
      {annotations.length && <path d="M377 44 339 25M304 214 240 184M339 25 240 184m95-158 8-2m-107 161 8-2" fill="none" stroke="var(--ridge)" strokeWidth=".9" />}
    </g>
  );
}

function ReBoard({ annotations }: StudyArtProps) {
  return <CellularBoard honeycomb={false} annotations={annotations} />;
}

function HoneycombBoard({ annotations }: StudyArtProps) {
  return <CellularBoard honeycomb annotations={annotations} />;
}

const bevelLeaders: StudyIllustration["leaders"] = [
  { key: "length", tip: [314, 65], bend: [233, 48], box: [235, 47], left: true },
  { key: "width", tip: [396, 52], bend: [445, 35], box: [450, 34] },
  { key: "thickness", tip: [380, 106], bend: [433, 80], box: [450, 79] },
  { key: "angle", tip: [327, 172], bend: [230, 112], box: [223, 110], left: true },
  { key: "depth", tip: [312, 217], bend: [418, 268], box: [425, 265] },
];

export const boardStudyArt = {
  "foam-board": {
    Art: FoamBoard,
    leaders: [
      { key: "length", tip: [251, 62], bend: [203, 49], box: [200, 47], left: true },
      { key: "motion", tip: [266, 117], bend: [205, 133], box: [198, 127], left: true },
      { key: "width", tip: [302, 42], bend: [374, 29], box: [389, 29] },
      { key: "thickness", tip: [320, 73], bend: [382, 69], box: [400, 69] },
      { key: "angle", tip: [303, 161], bend: [393, 110], box: [408, 109] },
      { key: "depth", tip: [312, 199], bend: [413, 268], box: [425, 265] },
    ],
  },
  "re-board": { Art: ReBoard, leaders: bevelLeaders },
  "honeycomb-board": { Art: HoneycombBoard, leaders: bevelLeaders },
} satisfies Record<string, StudyIllustration>;
