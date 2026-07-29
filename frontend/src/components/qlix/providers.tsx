"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "./theme-provider";
import { SessionProvider } from "./session-context";

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  // One QueryClient per browser session. Without this provider, components using `useQuery`
  // (e.g. the Leads views) throw "No QueryClient set" at runtime.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SessionProvider>{children}</SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
