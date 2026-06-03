"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AuthSuccessResponse } from "@/lib/auth-api";
import { getSession } from "@/lib/auth-api";

interface SessionContextValue {
  readonly session: AuthSuccessResponse | null;
  readonly loading: boolean;
  readonly refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [session, setSession] = useState<AuthSuccessResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getSession();
      setSession(s);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  return (
    <SessionContext.Provider value={{ session, loading, refresh }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
