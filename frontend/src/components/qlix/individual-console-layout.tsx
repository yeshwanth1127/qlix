"use client";

import { usePathname } from "next/navigation";
import { AppChrome } from "./app-chrome";

/**
 * Individual workspace: full-bleed UI on `/individual/overview` only; standard console chrome on other routes.
 */
export function IndividualConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isIndividualOverview = pathname === "/individual/overview";

  if (isIndividualOverview) {
    return <>{children}</>;
  }

  return <AppChrome>{children}</AppChrome>;
}
