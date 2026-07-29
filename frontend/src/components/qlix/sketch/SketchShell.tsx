"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface SketchShellProps {
  readonly sidebar: ReactNode;
  readonly topbar?: ReactNode;
  readonly bottomNav?: ReactNode;
  readonly children: ReactNode;
  readonly fullHeight?: boolean;
  readonly contentClassName?: string;
}

/** Dashboard shell: fixed left sidebar on md+, mobile header/bottom nav below. */
export function SketchShell({
  sidebar,
  topbar,
  bottomNav,
  children,
  fullHeight = false,
  contentClassName,
}: SketchShellProps) {
  return (
    <div
      data-sketch-console
      className={cn("text-black", fullHeight ? "h-dvh overflow-hidden" : "min-h-dvh")}
    >
      {sidebar}
      {topbar}
      {bottomNav}
      <div
        className={cn(
          "flex flex-col pl-0 md:pl-[10rem]",
          /* Mobile chrome: fixed top header + bottom nav */
          "pt-12 pb-[3.5rem] md:pt-0 md:pb-0",
          fullHeight ? "h-full min-h-0 overflow-hidden" : "min-h-dvh",
        )}
      >
        <div
          className={cn(
            "flex flex-1 flex-col px-3.5 sm:px-5 pb-3.5 sm:pb-5",
            fullHeight ? "min-h-0 overflow-hidden pt-3.5 sm:pt-5" : "pt-3.5 sm:pt-5",
            contentClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
