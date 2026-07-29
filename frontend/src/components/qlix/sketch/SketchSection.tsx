import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { sketchLabel } from "./tokens";

interface SketchSectionProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly headerRight?: ReactNode;
}

export function SketchSection({ title, children, className, headerRight }: SketchSectionProps) {
  return (
    <section className={cn("flex flex-col", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={cn(sketchLabel, "flex items-center gap-2")}>
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-[color:var(--sketch-purple)]/55"
          />
          {title}
        </h2>
        {headerRight}
      </div>
      {children}
    </section>
  );
}
