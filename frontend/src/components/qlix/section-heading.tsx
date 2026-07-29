import { sketchLabel } from "./sketch/tokens";

interface SectionHeadingProps {
  readonly title: string;
  readonly description?: string;
}

export function SectionHeading({ title, description }: SectionHeadingProps) {
  return (
    <div>
      <h2 className={sketchLabel}>{title}</h2>
      {description ? (
        <p className="mt-1 text-[13px] text-black/60">{description}</p>
      ) : null}
    </div>
  );
}
