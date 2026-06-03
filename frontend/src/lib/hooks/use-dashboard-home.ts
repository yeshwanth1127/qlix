"use client";

import { useCallback, useEffect, useState } from "react";
import type { DashboardHomeResponse } from "@/lib/dashboard-api";
import { getDashboardHome } from "@/lib/dashboard-api";

export function useDashboardHome() {
  const [data, setData] = useState<DashboardHomeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getDashboardHome();
      if (!result) {
        setData(null);
        setError("Could not load dashboard (try signing in again).");
        return;
      }
      setData(result);
    } catch {
      setError("Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}
