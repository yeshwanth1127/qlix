"use client";

import { AppChrome } from "./app-chrome";

/**
 * Individual workspace: standard console chrome (shared sidebar + topbar) on all routes.
 */
export function IndividualConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppChrome>{children}</AppChrome>;
}
