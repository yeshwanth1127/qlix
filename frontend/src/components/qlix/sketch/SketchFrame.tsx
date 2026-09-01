import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface SketchFrameProps {
  readonly children: ReactNode;
  readonly fullHeight?: boolean;
}

export function SketchFrame({ children, fullHeight = false }: SketchFrameProps) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col overflow-hidden bg-transparent",
        fullHeight
          ? "min-h-0"
          : "min-h-[calc(100dvh-3rem)]",
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
