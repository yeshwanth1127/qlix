import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { sketchFrame } from "./tokens";

interface SketchFrameProps {
  readonly children: ReactNode;
  readonly fullHeight?: boolean;
}

export function SketchFrame({ children, fullHeight = false }: SketchFrameProps) {
  return (
    <div
      className={cn(
        sketchFrame,
        "sketch-card sketch-rise flex flex-1 flex-col overflow-hidden",
        fullHeight
          ? "min-h-0"
          : "min-h-[calc(100dvh-5rem-3.5rem)] md:min-h-[calc(100dvh-5rem)]",
      )}
    >
      <div
        className={cn(
          "flex flex-1 flex-col",
          fullHeight
            ? "min-h-0 overflow-hidden p-3 sm:p-4"
            : "overflow-auto p-3 sm:p-5",
        )}
      >
        {children}
      </div>
    </div>
  );
}
