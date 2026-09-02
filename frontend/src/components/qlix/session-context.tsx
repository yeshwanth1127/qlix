"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
  const sessionRef = useRef<AuthSuccessResponse | null>(null);
  const bootstrappedRef = useRef(false);

  sessionRef.current = session;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getSession();
      setSession(next);
      sessionRef.current = next;
    } catch {
      setSession(null);
      sessionRef.current = null;
    } finally {
      setLoading(false);
      bootstrappedRef.current = true;
    }
  }, []);

  // Initial session load only — never flash a full-app Loading gate on every route change.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Soft revalidate after navigation so plugin / billing changes show up without blanking the UI.
  useEffect(() => {
    if (!bootstrappedRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await getSession();
        if (cancelled) return;
        // Keep the existing session on transient null (network blip). Explicit refresh() still clears.
        if (next || !sessionRef.current) {
          setSession(next);
          sessionRef.current = next;
        }
      } catch {
        // Ignore soft-refresh failures; keep the current session.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

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
