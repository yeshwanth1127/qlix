import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { sketchLabel } from "./tokens";

interface SketchPageHeaderProps {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly className?: string;
}

export function SketchPageHeader({ title, actions, className }: SketchPageHeaderProps) {
  return (
    <div className={cn("mb-7 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="h-5 w-[3px] rounded-full bg-[color:var(--sketch-purple)]"
        />
        <h1
          className={cn(
            sketchLabel,
            "text-[13px] font-semibold tracking-[0.18em] text-black",
          )}
        >
          {title}
        </h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
