import { useId } from "react";
import type { StudyArtProps, StudyIllustration } from "./extended-material-art";

const plane = "matrix(1 -.24 .95 .772 128 262)";
const elevation = "matrix(1 -.24 0 1 128 262)";

function DragBlade({ annotations }: StudyArtProps) {
  return (
    <g>
      <g transform="matrix(0 -.78 .95 -.24 324 110)" stroke="var(--contour)" strokeWidth="1.2">
        <path d="M-98 -12 -61 -22 78 -22 89 -12 89 14 -58 14Z" fill="var(--metal-edge)" />
        <path d="M-97 -16 -60 -26 81 -26 92 -16 92 10 -56 10Z" fill="var(--metal)" />
        <path d="M-97 -16 -56 10 -50 5 92 5M-59 -22 78 -22" fill="none" stroke="var(--metal-edge)" />
        <circle cx="57" cy="-9" r="6.6" fill="var(--edgey-drawing-plate)" />
        <path d="M51 -6a7 7 0 0 1 12 0" fill="none" stroke="var(--metal-edge)" />
      </g>
      <g stroke="var(--edgey-text-muted)" fill="none" strokeWidth=".85">
        {annotations.length && <path d="M289 42h-44m55 148h-55m6-148v148m-3-145 6-6m-6 154 6-6" />}
        {annotations.width && <path d="m300 101 33-8m-33 5v6m33-14v6" stroke="var(--cavity)" />}
      </g>
      {annotations.motion && <path d="m213 128 25-6-6-3m6 3-4 6" fill="none" stroke="var(--contour)" strokeWidth="1.2" />}
    </g>
  );
}

function Pvc({ annotations }: StudyArtProps) {
  const section = useId();
  const front = "M0 0h184v15H0Zm251 0h169v15H251Z";
  const recess = "M155.5 -30h67v15h-67Z";

  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <pattern id={section} width="11" height="11" patternUnits="userSpaceOnUse">
          <path d="m-3 3 6-6M0 11 11 0m-3 14 6-6" stroke="var(--cavity)" strokeWidth=".8" opacity=".64" />
        </pattern>
      </defs>
      <g transform={elevation}>
        <path d="M-57 -60 0 0v15l-57-60Z" fill="var(--plastic)" />
        <path d="M-30.4 -32v15l4 4v-15Z" fill="var(--cavity)" strokeWidth=".8" />
        <path d={recess} fill="var(--plastic)" />
        <path d={recess} fill={`url(#${section})`} stroke="none" />
        <path d="M222.5 -30 251 0v15l-28.5-30Z" fill="var(--plastic)" />
        <path d={front} fill="var(--plastic)" />
        <path d={front} fill={`url(#${section})`} stroke="none" />
      </g>
      <g transform={plane}>
        <path d="M0 -60h420V0H251v-30h-41L0 -32ZM0 -28l184-2V0H0Z" fill="color-mix(in srgb, var(--plastic) 48%, var(--film-back))" />
        <path d="m0-32 210 2-26 .25L0 -28Z" fill="var(--cavity)" stroke="none" />
        <g fill="none" stroke="var(--foam-edge)" strokeWidth=".85">
          <path d="M13 -54h75m5 0h11M275 -6h59m4 0h8M336 -54h71" />
          <path d="M20 -51h22m333 0h26" opacity=".6" />
        </g>
      </g>
      <DragBlade annotations={annotations} />
    </g>
  );
}

const bannerFace = "M0 -70C35 -77 58 -62 100 -61S172 -60 214 -60H315C351 -60 378 -43 401 -58Q413 -66 420 -77V-15Q398 16 371 10C352 7 335 -1 306 0H109C65 0 37 -14 0 -8V-37C47 -43 76 -29 110 -29L210 -30L110 -32C71 -32 42 -47 0 -41Z";

function Banner({ annotations }: StudyArtProps) {
  const scrim = useId();
  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <pattern id={scrim} width="10" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 2h10M3 0v8" fill="none" stroke="var(--metal-edge)" strokeWidth=".8" opacity=".51" />
          <path d="M3 2h3" fill="none" stroke="var(--film-back)" strokeWidth=".85" />
        </pattern>
      </defs>
      <g transform={plane}>
        <path d={bannerFace} transform="translate(0 3)" fill="var(--metal-edge)" />
        <path d={bannerFace} fill="var(--film-back)" />
        <path d={bannerFace} fill={`url(#${scrim})`} stroke="none" />
        <path d="M401 -58q12-8 19-19v62q-19 27-41 26c14-10 15-49 22-69Z" fill="var(--film)" stroke="none" opacity=".55" />
        <g stroke="var(--metal-edge)" strokeWidth=".85" fill="none" opacity=".78">
          <path d="M17 -64c23-3 40 4 65 6m257 5c17 1 36 11 52 4M341 0c12 2 22 6 32 6" />
          <path d="M403 -50q5-3 10-10m-20 59q9-5 17-15" />
        </g>
      </g>
      <DragBlade annotations={annotations} />
    </g>
  );
}

const panelFace = "M0 -57C16 -55 26 -73 46 -72S74 -48 100 -54S132 -71 157 -63S188 -59 213 -60S243 -75 262 -68S283 -45 309 -52S343 -71 367 -60S400 -57 414 -64L421 -1C398 6 392 11 372 2S344 -10 323 -1S287 17 268 5S247 -13 225 -7S185 8 165 2S136 -11 116 -2S87 15 67 6S43 -12 25 -7S7 7 -4 7L-2 -23C19 -23 27 -42 46 -39S75 -20 101 -25S132 -38 155 -31S186 -26 210 -30C185 -28 175 -27 155 -34S122 -34 101 -29S60 -41 46 -43S14 -29 -2 -27Z";

function SoftSignage({ annotations }: StudyArtProps) {
  const id = useId();
  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <clipPath id={id + "-panel"}><path d={panelFace} /></clipPath>
        <pattern id={id + "-weave"} width="9" height="7" patternUnits="userSpaceOnUse">
          <path d="M0 2q2-1 4 0t5 0m-7 2v2m5-7v2" fill="none" stroke="var(--cloth-edge)" strokeWidth=".8" opacity=".65" />
        </pattern>
      </defs>
      <g transform={plane}>
        <path d={panelFace} transform="translate(0 1.8)" fill="var(--cloth-edge)" />
        <path d={panelFace} fill="var(--cloth)" />
        <g clipPath={`url(#${id}-panel)`} stroke="none">
          <g fill="var(--cloth-edge)" opacity=".79">
            <path d="M45 -74C37 -55 42 -23 27 -3l18-1c12-16 8-49 17-64ZM157 -67c-4 17-11 39-32 63l14-4c17-15 21-37 31-55ZM260 -71c-2 25-11 45-29 66l18 2c13-18 17-40 25-59ZM360 -68c3 18-7 52-21 62l13-1c11-10 16-34 24-52Z" />
          </g>
          <g fill="none" stroke="var(--film-back)" opacity=".47">
            <path d="M-10 -52c38 14 67-33 116-23M-10 -48c39 14 68-34 117-23M264 24c17-27 42-30 60-39s31-22 43-32 31-15 59-16" strokeWidth="3" />
            <path d="M263 32c23-34 44-35 65-46s31-22 44-32 31-14 56-15" strokeWidth="1.2" />
          </g>
          <path d={panelFace} fill={`url(#${id}-weave)`} />
          <path d="M75 -56c-2 8-1 13-5 18m42-12c-3 9-10 14-11 19m94-25c-3 6-9 12-12 15m121-1c-2 10-8 20-14 26m87-33c-1 19-6 31-11 40" fill="none" stroke="var(--cloth-edge)" strokeWidth=".9" />
        </g>
      </g>
      <g transform="matrix(.87 -.22 0 1 309 113)" strokeWidth="1.2">
        <polygon points="68.48,28.25 42.32,64.25 0,78 -42.32,64.25 -68.48,28.25 -68.48,-16.25 -42.32,-52.25 0,-66 42.32,-52.25 68.48,-16.25" fill="var(--metal-edge)" />
        <polygon points="68.48,22.25 42.32,58.25 0,72 -42.32,58.25 -68.48,22.25 -68.48,-22.25 -42.32,-58.25 0,-72 42.32,-58.25 68.48,-22.25" fill="var(--metal)" />
        <polygon points="59.92,19.47 37.03,50.97 0,63 -37.03,50.97 -59.92,19.47 -59.92,-19.47 -37.03,-50.97 0,-63 37.03,-50.97 59.92,-19.47" fill="none" stroke="var(--metal-edge)" strokeWidth=".9" />
        <circle r="18" fill="var(--edgey-drawing-plate)" />
        <path d="M-17 6a18 18 0 0 1 34 0" stroke="var(--metal-edge)" fill="none" />
        <path d="M-62 20a63 63 0 0 0 120 5" fill="none" stroke="var(--metal-edge)" strokeWidth=".85" strokeDasharray="4 4" />
      </g>
      {annotations.motion && <path d="M228 131q-5-20 6-39m-7 4 7-4 1 8" fill="none" strokeWidth="1.2" />}
    </g>
  );
}

const dragLeaders: StudyIllustration["leaders"] = [
  { key: "length", tip: [251, 64], bend: [206, 48], box: [201, 48], left: true },
  { key: "motion", tip: [213, 128], bend: [193, 137], box: [178, 136], left: true },
  { key: "thickness", tip: [336, 65], bend: [389, 32], box: [393, 32] },
  { key: "width", tip: [317, 97], bend: [396, 68], box: [411, 71] },
  { key: "angle", tip: [324, 176], bend: [398, 96], box: [415, 111] },
  { key: "depth", tip: [309, 190], bend: [414, 268], box: [416, 265] },
];

export const flexibleStudyArt = {
  pvc: { Art: Pvc, leaders: dragLeaders },
  banner: { Art: Banner, leaders: dragLeaders },
  "soft-signage": {
    Art: SoftSignage,
    leaders: [
      { key: "diameter", tip: [309, 41], bend: [369, 30], box: [385, 30] },
      { key: "bore", tip: [293, 116], bend: [195, 55], box: [192, 55], left: true },
      { key: "motion", tip: [227, 118], bend: [187, 140], box: [179, 140], left: true },
      { key: "thickness", tip: [367, 124], bend: [399, 81], box: [413, 80] },
      { key: "depth", tip: [309, 190], bend: [414, 268], box: [416, 265] },
    ],
  },
} satisfies Record<string, StudyIllustration>;
