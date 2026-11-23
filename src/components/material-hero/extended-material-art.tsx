import type { ComponentType } from "react";
import type { AdditionalStudyMaterial, StudyAnnotation } from "@/lib/catalogue/material-hero";
import { boardStudyArt } from "./board-study-art";
import { filmStudyArt } from "./film-study-art";
import { flexibleStudyArt } from "./flexible-study-art";
import { annotationTags } from "./material-art";
import styles from "./material-art.module.css";

export type StudyArtProps = { annotations: Partial<Record<StudyAnnotation, string>> };

export type StudyIllustration = {
  Art: ComponentType<StudyArtProps>;
  leaders: readonly {
    key: StudyAnnotation;
    tip: [number, number];
    bend: [number, number];
    box: [number, number];
    left?: boolean;
  }[];
};

const illustrations: Record<AdditionalStudyMaterial, StudyIllustration> = {
  ...boardStudyArt,
  ...filmStudyArt,
  ...flexibleStudyArt,
};

export function additionalIllustration(material: string): StudyIllustration | undefined {
  return Object.hasOwn(illustrations, material) ? illustrations[material as AdditionalStudyMaterial] : undefined;
}

export function AdditionalMaterialDrawing({ illustration: { Art, leaders }, annotations }: {
  illustration: StudyIllustration;
} & StudyArtProps) {
  const callouts = leaders.filter(({ key }) => annotations[key]);
  return (
    <svg className={`${styles.drawing} ${styles.coreSheet}`} viewBox="0 0 620 314" aria-hidden="true" focusable="false">
      <g fill="none" stroke="var(--ridge)" strokeWidth=".85">
        <path d="M10 19v-9h9m582 0h9v9M10 295v9h9m582 0h9v-9" />
        <path d="M35 255 584 123M309 13v277" opacity=".55" strokeDasharray="13 4 2 4" />
      </g>
      <Art annotations={annotations} />
      <g className={styles.leader}>
        {callouts.map(({ key, tip: [x, y], bend: [bx, by], left }) => (
          <g key={key}>
            <path d={`M${x} ${y}L${bx} ${by}H${left ? 25 : 595}`} />
            <circle cx={x} cy={y} r="2.5" />
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
