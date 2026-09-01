import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { StrokeText } from "./StrokeText";

interface SketchPageHeaderProps {
  readonly title: string;
  /** One short line under the title — keep it to a single sentence. */
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function SketchPageHeader({ title, subtitle, actions, className }: SketchPageHeaderProps) {
  return (
    <div className={cn("mb-7 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 flex-1">
        <h1 className="max-w-[38rem]" aria-label={title}>
          <span className="sr-only">{title}</span>
          <StrokeText text={title} />
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
