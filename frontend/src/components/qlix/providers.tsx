"use client";

import { ThemeProvider } from "./theme-provider";
import { SessionProvider } from "./session-context";

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider>
      <SessionProvider>{children}</SessionProvider>
    </ThemeProvider>
  );
}
