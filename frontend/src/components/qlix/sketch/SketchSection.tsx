import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { sketchLabel } from "./tokens";

interface SketchSectionProps {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly titleClassName?: string;
  readonly headerRight?: ReactNode;
  readonly id?: string;
}

export function SketchSection({
  title,
  children,
  className,
  titleClassName,
  headerRight,
  id,
}: SketchSectionProps) {
  return (
    <section id={id} className={cn("flex flex-col", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className={cn(sketchLabel, "flex items-center gap-2", titleClassName)}>
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
