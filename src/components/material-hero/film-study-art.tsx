import { useId } from "react";
import type { StudyArtProps, StudyIllustration } from "./extended-material-art";

const edgeProjection = "matrix(1 -.24 0 1 128 262)";
const faceShear = "matrix(1 0 .95 1 0 0)";

function DragBlade({ profile, annotations }: StudyArtProps & { profile: "mimaki60" | "summa60" }) {
  const mimaki = profile === "mimaki60";
  const transform = mimaki ? "matrix(0 -.70 1 -.24 314.4 111.2)" : "matrix(0 -.70 1 -.24 302.4 113.4)";

  return (
    <g>
      <g transform={transform} stroke="var(--contour)" strokeWidth="1.2">
        {mimaki ? <>
          <path d="M-108-5.4-72-8H96l12 6.8v2.4L96 8H-84.8Z" fill="var(--metal)" />
          <path d="m-108-5.4 36-2.6q7 5 7 8-4 5-13 8h-6.8Z" fill="var(--metal-edge)" />
          <path d="m-108-5.4 33 7 10-1.6m-10 1.6L-84.8 8M96-8q5 6.8 0 16m12-8.4-10 2.6" fill="none" />
          <path d="M-59-4.8H92M-64 5.8H94" stroke="var(--metal-edge)" strokeWidth=".9" />
        </> : <>
          <path d="M-109 6.6l20.9-14q2.1-1.3 6-1.3H97.7L107.8-2q2.8 2.1 0 4.2l-9.6 6.3H-94.9Z" fill="var(--metal)" />
          <path d="M-109 6.6l20.9-14q2.1-1.3 6-1.3 19.8.6 27.2 4.4 8.1 4-4 8.4-14.8 4.5-36 4.4Z" fill="var(--metal-edge)" />
          <path d="M97.8-8.7q5.5 8.6.6 17.2l9.5-6.3q2.5-2.1-.1-4.2Z" fill="var(--metal-edge)" />
          <path d="M-49-5.4H88m13.4 7 6.2-1" fill="none" stroke="var(--metal-edge)" strokeWidth=".9" />
          <path d="M-48 0H94" fill="none" stroke="var(--metal-edge)" strokeWidth=".8" strokeDasharray="4 5" />
        </>}
      </g>
      {annotations.length && <path d="M292 36h-45m52 152h-52m5-152v152m-3-149 6-6m-6 158 6-6" stroke="var(--edgey-text-muted)" strokeWidth=".9" fill="none" />}
      {annotations.motion && <path d="m261 115 24-6m-6-3 6 3-4 5" stroke="var(--contour)" strokeWidth="1.5" fill="none" />}
    </g>
  );
}

function ReflectiveFilm({ annotations }: StudyArtProps) {
  const id = useId();

  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <pattern id={id + "-fleck"} width="7" height="7" patternUnits="userSpaceOnUse">
          <rect width="7" height="7" stroke="none" fill="var(--film)" />
          <path d="m1 2 .8-.3m2.7 4 .8-.3" fill="none" stroke="var(--film-back)" strokeWidth=".85" />
          <path d="m1.6 2.8 .8-.3m2.7 4 .8-.3" fill="none" stroke="var(--ridge)" strokeWidth=".75" opacity=".5" />
        </pattern>
      </defs>
      <g transform={edgeProjection}>
        <path d="M-58-61 0 0v4l-58-61Z" fill="var(--liner)" />
        <path d="M0 0h420v4H0Z" fill="var(--paper)" />
        <g transform={faceShear}>
          <path d="M0-61h420V0H0Z" fill="var(--paper)" />
          <path d="M0-61h420V0H106Q52-3 0-28Z" fill={`url(#${id}-fleck)`} />
          <path d="M285-61h39L271 0h-40zm47 0h8L287 0h-8z" fill="var(--film-back)" stroke="none" opacity=".65" />
          <path d="m349-61-53 61m62-61-53 61" stroke="var(--film-back)" strokeWidth=".8" opacity=".8" />
          <path d="m0-32 210 1.5L0-28Z" fill="var(--paper)" strokeWidth=".8" />
          <path d="M0-28Q35-41 47-49C70-51 78-9 106 0Q55-3 0-28Z" fill="var(--film-back)" />
          <path d="M47-49C63-47 70-26 80-16m-38-26c15-1 24 14 32 26" fill="none" stroke="var(--ridge)" strokeWidth=".8" opacity=".7" />
        </g>
      </g>
      <DragBlade profile="mimaki60" annotations={annotations} />
    </g>
  );
}

function Laminate({ annotations }: StudyArtProps) {
  const id = useId();
  const layer = `url(#${id}-plies)`;

  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <pattern id={id + "-plies"} width="16" height="9" patternUnits="userSpaceOnUse">
          <rect width="16" height="9" fill="var(--film-back)" stroke="none" />
          <path d="M0 2.2h16v2.3H0Z" fill="var(--plastic)" stroke="none" />
          <path d="M0 2.2h16M0 6.4h16" fill="none" stroke="var(--ridge)" strokeWidth=".8" />
        </pattern>
      </defs>
      <g transform={edgeProjection}>
        <path d="M-58-61 0 0v9l-58-61Z" fill="var(--plastic)" />
        <path d="m-58-58 58 61m-58-57 58 61" stroke="var(--ridge)" fill="none" strokeWidth=".8" />
        <g transform="translate(145 -30.5)">
          <path d="M0 0h73v9H0Z" fill={layer} />
        </g>
        <path d="M218-30.5 247 0v9l-29-30.5Z" fill="var(--plastic)" />
        <path d="M218-28.3 247 2.2m-29-26.3L247 6.4" fill="none" stroke="var(--ridge)" strokeWidth=".8" />
        <path d="M0 0h174v9H0ZM247 0h173v9H247Z" fill={layer} />
        <g transform={faceShear}>
          <path d="M0-61h420V0H247v-30.5h-73V0H0Z" fill="var(--film-back)" />
          <path d="M296-61h40L296 0h-40zm46 0h6L308 0h-6Z" fill="var(--edgey-drawing-plate)" opacity=".22" stroke="none" />
          <path d="M12-55h48m6 0h18M15-7h32m302-5h60m-39-36h32" fill="none" stroke="var(--ridge)" strokeWidth=".8" opacity=".58" />
          <path d="m0-32 210 1.5h-36L0-28.7Z" fill="var(--core)" strokeWidth=".8" />
        </g>
      </g>
      <DragBlade profile="summa60" annotations={annotations} />
    </g>
  );
}

function Flock({ annotations }: StudyArtProps) {
  const id = useId();
  const cut = `url(#${id}-ends)`;

  return (
    <g stroke="var(--contour)" strokeWidth="1.15">
      <defs>
        <pattern id={id + "-nap"} patternUnits="userSpaceOnUse" width="23" height="15">
          <rect width="23" height="15" fill="var(--cloth)" stroke="none" />
          <path d="M2 6.8 1.7 3m1.4 3.1.7-2.5M8.6 13l.3-3.3m1.5 3.2 1-2.8M16 5.7l-.4-3.2m1.5 3 .9-2.2m2.4 8.6.9-3.1" fill="none" stroke="var(--cloth-edge)" strokeWidth=".85" />
          <path d="m2 6.5-.2-2.2M8.6 13l.2-1.7M16 5.7l-.3-2" fill="none" stroke="var(--film-back)" strokeWidth=".8" opacity=".45" />
        </pattern>
        <pattern id={id + "-ends"} width="14" height="11" patternUnits="userSpaceOnUse">
          <rect width="14" height="11" stroke="none" fill="var(--cloth-edge)" />
          <path d="m.5 7.7.7-6.3m1.3 6.8L4.1.8m1.2 7.4.4-5.2m1.8 5.1L8.8.6m.9 7.6 1.7-6.1m.5 6.1 1.5-7" stroke="var(--cloth)" fill="none" strokeWidth=".9" />
          <path d="m1.1 5.2.4-3.4m5.9 4 .9-4" stroke="var(--film-back)" opacity=".48" fill="none" strokeWidth=".75" />
          <path d="M0 8.6h14V11H0Z" fill="var(--plastic)" stroke="none" />
          <path d="M0 8.6h14" fill="none" stroke="var(--contour)" strokeWidth=".75" />
        </pattern>
      </defs>
      <g transform={edgeProjection}>
        <path d="M-58-61 0 0v11l-58-61Z" fill="var(--cloth-edge)" />
        <path d="m-58-52 58 61" stroke="var(--plastic)" strokeWidth="1.6" />
        <g transform="translate(154 -30.5)">
          <path d="M0 0h55v11H0Z" fill={cut} />
        </g>
        <path d="M209-30.5 261 0v11l-52-30.5Z" fill="var(--cloth-edge)" />
        <path d="m209-21.8 52 30.5" stroke="var(--plastic)" strokeWidth="1.6" />
        <path d="M0 0h166v11H0ZM261 0h159v11H261Z" fill={cut} />
        <path d="M-58-61h420L420 0H261l-52-30.5h-55L166 0H0Z" fill={`url(#${id}-nap)`} />
        <path d="m0-33 210 2.5h-27L0-27.8Z" transform={faceShear} fill="var(--cloth-edge)" strokeWidth=".8" />
        <path d={Array.from({ length: 54 }, (_, i) => {
          const x = -57 + i * 7.8;
          return `M${x} -60.8l${i % 3 * .35 - .8} -${2.3 + i % 4 * .6}m2.1 2.7l.7-2.2`;
        }).join("")} fill="none" stroke="var(--cloth-edge)" strokeWidth=".85" />
      </g>
      <DragBlade profile="summa60" annotations={annotations} />
    </g>
  );
}

const summaLeaders: StudyIllustration["leaders"] = [
  { key: "length", tip: [252, 65], bend: [200, 48], box: [204, 48], left: true },
  { key: "motion", tip: [261, 115], bend: [201, 125], box: [202, 125], left: true },
  { key: "diameter", tip: [310.9, 72], bend: [384, 38], box: [394, 38] },
  { key: "angle", tip: [301, 179], bend: [398, 102], box: [414, 103] },
  { key: "depth", tip: [309, 188], bend: [405, 268], box: [421, 269] },
];

export const filmStudyArt = {
  "reflective-film": {
    Art: ReflectiveFilm,
    leaders: [
      { key: "length", tip: [252, 65], bend: [200, 48], box: [204, 48], left: true },
      { key: "motion", tip: [261, 115], bend: [201, 125], box: [202, 125], left: true },
      { key: "diameter", tip: [322.4, 72], bend: [384, 38], box: [394, 38] },
      { key: "angle", tip: [314, 177], bend: [398, 102], box: [414, 103] },
    ],
  },
  laminate: { Art: Laminate, leaders: summaLeaders },
  flock: { Art: Flock, leaders: summaLeaders },
} satisfies Record<string, StudyIllustration>;
