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
  readonly overlayNavigation?: boolean;
  readonly persistentNavigation?: boolean;
}

/** Dashboard shell: fixed left sidebar on md+, mobile header/bottom nav below. */
export function SketchShell({
  sidebar,
  topbar,
  bottomNav,
  children,
  fullHeight = false,
  contentClassName,
  overlayNavigation = false,
  persistentNavigation = false,
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
          "flex flex-col",
          persistentNavigation
            ? "pl-[13rem] md:pl-[18rem]"
            : !overlayNavigation && "pl-0 md:pl-[14rem]",
          topbar ? "pt-12" : null,
          !topbar && overlayNavigation ? "pt-0 pb-0" : null,
          !topbar && !overlayNavigation ? "pt-12 pb-[3.5rem] md:pt-0 md:pb-0" : null,
          bottomNav ? "pb-[3.5rem] md:pb-0" : null,
          fullHeight ? "h-full min-h-0 overflow-hidden" : "min-h-dvh",
        )}
      >
        <div
          className={cn(
            "flex flex-1 flex-col px-4 sm:px-6 lg:px-8 pb-4 sm:pb-6",
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
