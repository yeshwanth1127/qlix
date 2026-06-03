"use client";

import { useCallback, useEffect, useState } from "react";
import type { PassportsOverviewResponse } from "@/lib/passports-api";
import { getPassportsOverview } from "@/lib/passports-api";

export function usePassportsOverview() {
  const [data, setData] = useState<PassportsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPassportsOverview();
      if (!result) {
        setData(null);
        setError("Could not load passports (try signing in again).");
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
