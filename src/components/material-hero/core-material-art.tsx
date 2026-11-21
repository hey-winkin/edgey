import { useId } from "react";
import { annotationTags } from "./material-art";
import styles from "./material-art.module.css";

type Material = "vinyl" | "correx" | "foamex" | "textile";
type Key = keyof typeof annotationTags;
type Annotations = Partial<Record<Key, string>>;

function isMaterial(value: string): value is Material {
  return value === "vinyl" || value === "correx" || value === "foamex" || value === "textile";
}

function Sheet({ material, tile = false }: { material: Material; tile?: boolean }) {
  const id = useId();
  const width = tile ? 120 : 420;
  const bed = tile ? 24 : 61;
  const height = material === "correx" ? 22 : material === "foamex" ? 19 : material === "vinyl" ? 6 : 2;
  const rigid = material === "foamex" || material === "correx";
  const section = rigid && !tile;
  const face = material === "foamex" ? "var(--foam)" : "var(--plastic)";
  const notch = section ? "H251v-" + bed / 2 + "h-67V0" : "";
  const peel = material === "vinyl" ? (tile ? 50 : 90) : 0;
  const selvedge = tile ? "q-10 -2 -20 0 -14 2 -28 0 -16 -2 -30 0 -9 2 -20 0 -10 -1 -22 0" :
    "q-19 -3 -40 -1 -18 2 -37 0 -25 -3 -50 1 -20 3 -40 1 -22 -3 -45 -1 -35 3 -69 0 -17 -2 -39 0 -27 3 -56 -1 -23 -3 -44 1";
  const outline = `M0 ${-bed}h${width}V0${notch}H${peel}` +
    (peel ? `Q${peel * .48} -1 0 ${-bed / 2}` : "") + "Z";
  const pitch = tile ? 18 : 22;

  function edge(start: number, end: number, y = 0) {
    const w = end - start;
    return (
      <g transform={`translate(${start} ${y})`}>
        <path d={`M0 0h${w}v${height}H0Z`} fill={material === "correx" ? "var(--cavity)" : "var(--foam-edge)"} />
        {material === "correx" && <>
          <path d={`M0 0h${w}v2.5H0zM0 ${height - 2.5}h${w}V${height}H0z`} fill="var(--plastic)" strokeWidth=".7" />
          {Array.from({ length: Math.floor((w - 4) / pitch) }, (_, i) => (
            <g key={i} transform={`translate(${8 + i * pitch} 2.5)`}>
              <path d={`M3 0h7l-7 ${height - 5}Z`} fill="var(--edgey-drawing-plate)" opacity=".35" stroke="none" />
              <path d={`M0 0h3v${height - 5}H0Z`} fill="var(--plastic)" strokeWidth=".7" />
            </g>
          ))}
        </>}
        {material === "foamex" && <rect width={w} height={height} fill={`url(#${id}-pores)`} stroke="none" />}
      </g>
    );
  }

  return (
    <g transform={tile ? "matrix(.89 -.20 0 .75 23 48)" : "matrix(1 -.24 0 1 128 262)"} stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        {material === "vinyl" && <pattern id={id + "-face"} x="0" y={-bed} patternUnits="userSpaceOnUse" width={width} height={bed} viewBox="0 0 420 61" preserveAspectRatio="none">
          <rect width="420" height="61" fill="var(--film)" stroke="none" />
          <path d="M66 0h76L98 61H41zm89 0h8l-45 61h-10zM365 0h28l-47 61h-37z" fill="var(--film-back)" opacity=".59" stroke="none" />
          <path d="m204 0-45 61m229-61-46 61" stroke="var(--film-back)" fill="none" strokeWidth=".9" />
        </pattern>}
        {material === "textile" && <pattern id={id + "-face"} width="12" height="10" patternUnits="userSpaceOnUse">
          <rect width="12" height="10" fill="var(--cloth)" stroke="none" />
          <g fill="none" stroke="var(--cloth-edge)" strokeWidth="1.2">
            <path d="M0 2.5q3-1 6 0t6 0M0 7.5q3 1 6 0t6 0" />
            <path d="M2.5 3.5v3m6-8v3m0 7v3" strokeWidth="2.5" />
          </g>
        </pattern>}
        {material === "foamex" && <pattern id={id + "-pores"} patternUnits="userSpaceOnUse" width="29" height="16">
          <path d="m2 4 1.5-.6m5 7 .8 1m6-9 2 .5m3 5-1.2.6m8 3 .7-1.4" fill="none" stroke="var(--cavity)" strokeWidth="1.2" opacity=".78" />
          <path d="m6 6 .8.3m8 7 1.6-.3m8-10 1.3.6" fill="none" stroke="var(--contour)" strokeWidth=".85" />
        </pattern>}
      </defs>
      <path d={`M0 0 ${-bed * .95} ${-bed}v${height}L0 ${height}Z`} fill={rigid ? face : "var(--liner)"} />
      {rigid ? <>
        {section && <>
          {edge(184 - bed * .475, 251 - bed * .475, -bed / 2)}
          <path d={`M251 0 ${251 - bed * .475} ${-bed / 2}v${height}L251 ${height}Z`} fill={face} />
        </>}
        {edge(0, section ? 184 : width)}
        {section && edge(251, width)}
      </> : material === "vinyl" ? (
        <path d={`M0 0h${width}v${height}H0Z`} fill="var(--liner)" />
      ) : <path d={`M${width} 0v2${selvedge}v-2Z`} fill="var(--cloth-edge)" />}
      <g transform="matrix(1 0 .95 1 0 0)">
        {peel > 0 && <path d={`M0 ${-bed}h${width}V0H0Z`} fill="var(--paper)" />}
        <path d={material === "textile" ? `M0 ${-bed}h${width}V0${selvedge}Z` : outline} fill={rigid ? face : `url(#${id}-face)`} />
        {material === "correx" && <g fill="none" stroke="var(--ridge)" opacity=".65" strokeWidth=".8">
          <path d={tile ? "M9-21v18m36-18v18m18-18v18m36-18v18" : "M31-57v51m22-48v48m44-51v49m66-48v50m22-51v18m90-17v48m44-46v47m66-51v48"} />
        </g>}
        {material === "foamex" && <path d={`m${width * .72} ${-bed}h${width * .1}L${width * .69} 0h-${width * .1}z`} fill="var(--edgey-drawing-plate)" opacity=".19" stroke="none" />}
        {!tile && <path d={`M0 ${-bed / 2 - 1.5}L210 ${-bed / 2}L0 ${-bed / 2 + (peel ? 4 : 2)}Z`} fill={peel ? "var(--paper)" : "var(--edgey-drawing-plate)"} stroke="var(--contour)" strokeWidth=".75" />}
        {peel > 0 && <path d={`M0 ${-bed / 2}Q${peel * .48} -1 ${peel} 0Q${peel * .70} -5 ${peel * .61} ${-bed * .85}Q${peel * .34} ${-bed * .73} 0 ${-bed / 2}Z`} fill="var(--film-back)" />}
      </g>
      {material === "textile" && (
        <path d={tile ? "m8 2 2 4 6 2m10-6 3 3 7 1m22-4 3 3m19-3 2 3 8 1m19-4 2 3" : "m11 2 4 4 10 2m12-6 5 3 8 1m24-4 3 3 9 1m34-4 4 2 8 2m122-4 4 3 12 1m15-4 5 3m44-3 4 3 9 1m30-4 5 3 8 1"} fill="none" stroke="var(--cloth-edge)" strokeWidth="1.4" />
      )}
    </g>
  );
}

function Blade({ material }: { material: Material }) {
  switch (material) {
    case "vinyl":
      return <g transform="matrix(0 -.70 1 -.24 312 112)">
        <path d="M-108 -3L-80 -8H96L108 -1.2V1.2L96 8H-97Z" fill="var(--metal)" />
        <path d="M-108 -3L-80 -8Q-73 -3 -73 0Q-77 5 -86 8H-97Z" fill="var(--metal-edge)" />
        <path d="M-108 -3L-83 1.6L-73 0M-83 1.6L-97 8M96 -8Q101 -1.2 96 8M108 -.4l-10 2.6" fill="none" />
        <path d="M-67 -4.8H92M-72 5.8H94" fill="none" stroke="var(--metal-edge)" strokeWidth=".9" />
      </g>;
    case "correx":
      return <g transform="matrix(0 -.87 .92 -.22 309 122)">
        <path d="M-101 2 -48 -12 -24 -12 -18 -18 81 -18 88 -12 88 13 79 18 -17 18 -26 9 -47 9Z" fill="var(--metal-edge)" />
        <path d="M-101 0 -48 -15 -24 -15 -17 -20 81 -20Q91 -18 91 -2Q91 13 81 15H-16L-24 6 -48 6Z" fill="var(--metal)" />
        <path d="M82 -20Q72 -14 73 -2Q74 11 81 15M-16 -20q-11 14 0 35M-101 0l55 -6 22 -1M-7 -13h75" fill="none" stroke="var(--metal-edge)" />
        <path d="M-16 -1H88" fill="none" stroke="var(--metal-edge)" strokeDasharray="4 5" />
      </g>;
    case "foamex":
      return <g transform="matrix(0 -.87 .95 -.24 324 122)">
        <path d="M-98 -12 -61 -22 78 -22 89 -12 89 14 -58 14Z" fill="var(--metal-edge)" />
        <path d="M-97 -16 -60 -26 81 -26 92 -16 92 10 -56 10Z" fill="var(--metal)" />
        <path d="M-97 -16 -56 10 -50 5 92 5M-59 -22 78 -22" fill="none" stroke="var(--metal-edge)" />
        <circle cx="57" cy="-9" r="6.6" fill="var(--edgey-drawing-plate)" />
        <path d="M51 -6a7 7 0 0 1 12 0M-72 11 84 11" fill="none" stroke="var(--metal-edge)" />
      </g>;
    case "textile":
      return <g transform="matrix(.87 -.22 0 1 309 113)">
        <polygon points="68.48,28.25 42.32,64.25 0,78 -42.32,64.25 -68.48,28.25 -68.48,-16.25 -42.32,-52.25 0,-66 42.32,-52.25 68.48,-16.25" fill="var(--metal-edge)" />
        <polygon points="68.48,22.25 42.32,58.25 0,72 -42.32,58.25 -68.48,22.25 -68.48,-22.25 -42.32,-58.25 0,-72 42.32,-58.25 68.48,-22.25" fill="var(--metal)" />
        <polygon points="59.92,19.47 37.03,50.97 0,63 -37.03,50.97 -59.92,19.47 -59.92,-19.47 -37.03,-50.97 0,-63 37.03,-50.97 59.92,-19.47" fill="none" stroke="var(--metal-edge)" />
        <circle r="18" fill="var(--edgey-drawing-plate)" />
        <path d="M-17 6a18 18 0 0 1 34 0" stroke="var(--metal-edge)" fill="none" />
        <path d="M-62 20a63 63 0 0 0 120 5" fill="none" stroke="var(--metal-edge)" strokeDasharray="4 4" />
      </g>;
  }
}

type Leader = { key: Key; tip: [number, number]; bend: [number, number]; box: [number, number]; left?: boolean };

function leaders(material: Material): Leader[] {
  const rotary = material === "textile";
  const bottom = rotary ? 191 : 210;
  return [
    { key: "length", tip: [252, 64], bend: [202, 47], box: [204, 48], left: true },
    { key: "motion", tip: [rotary ? 224 : 256, 114], bend: [200, 128], box: [198, 123], left: true },
    { key: "shank", tip: [318, 73], bend: [366, 35], box: [383, 35] },
    { key: "diameter", tip: rotary ? [309, 41] : [320, 74], bend: [365, 35], box: [383, 35] },
    { key: "thickness", tip: rotary ? [368, 124] : material === "correx" ? [313, 156] : [337, 81], bend: [400, 71], box: [420, 71] },
    { key: "angle", tip: [material === "foamex" ? 320 : 309, material === "vinyl" ? 177 : 189], bend: [405, 107], box: [425, 111] },
    { key: "depth", tip: [309, bottom], bend: [410, 268], box: [421, 266] },
    { key: "range", tip: [210, 252], bend: [158, 298], box: [102, 287], left: true },
  ];
}

export function CoreMaterialDrawing({ material, annotations }: { material: string; annotations: Annotations }) {
  if (!isMaterial(material)) return null;
  const callouts = leaders(material).filter(({ key }) => annotations[key]);
  const top = material === "vinyl" ? 37 : 43;
  const bottom = material === "vinyl" ? 188 : 210;
  return (
    <svg className={`${styles.drawing} ${styles.coreSheet}`} viewBox="0 0 620 314" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--ridge)" strokeWidth=".85">
        <path d="M10 19v-9h9m582 0h9v9M10 295v9h9m582 0h9v-9" />
        <path d="M35 255 584 123M309 13v277" opacity=".55" strokeDasharray="13 4 2 4" />
      </g>
      <Sheet material={material} />
      <g stroke="var(--contour)" strokeWidth="1.2"><Blade material={material} /></g>
      {annotations.length && <path d={`M286 ${top}h-40m52 ${bottom - top}h-52m6 0V${top}m-3 3 6-6m-6 ${bottom - top + 6} 6-6`} fill="none" stroke="var(--edgey-text-muted)" strokeWidth=".9" />}
      {annotations.motion && <path d={
        material === "correx" ? "M262 100v27m-4-22 4-5 4 5m-8 17 4 5 4-5" :
        material === "textile" ? "M228 131q-5-20 6-39m-7 4 7-4 1 8" : "m259 115 26-6m-6-3 6 3-4 6"
      } fill="none" stroke="var(--contour)" strokeWidth="1.5" />}
      <g className={styles.leader}>
        {callouts.map(({ key, tip: [x, y], bend: [bx, by], left }) => (
          <g key={key}>
            <path d={`M${x} ${y}L${bx} ${by}H${left ? 25 : 595}`} />
            {key !== "length" && key !== "motion" && <circle cx={x} cy={y} r="2.5" />}
            <text x={left ? 25 : 595} y={by - 7} textAnchor={left ? "start" : "end"}>{annotations[key]}</text>
          </g>
        ))}
      </g>
      <g className={styles.compactLeaders}>
        {callouts.map(({ key, tip: [x, y], box: [bx, by], left }) => (
          <g key={key}>
            <path d={`M${x} ${y}L${bx + (left ? 15 : -15)} ${by}`} />
            <rect x={bx - 15} y={by - 15} width="30" height="30" />
            <text x={bx} y={by} dy=".35em" textAnchor="middle">{annotationTags[key]}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function CoreMaterialSwatch({ material }: { material: string }) {
  if (!isMaterial(material)) return null;
  return (
    <svg className={`${styles.swatch} ${styles.coreSheet}`} viewBox="0 0 134 74" aria-hidden="true" focusable="false">
      <Sheet material={material} tile />
    </svg>
  );
}
