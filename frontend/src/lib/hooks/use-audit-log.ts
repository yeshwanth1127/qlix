"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditLogResponse } from "@/lib/dashboard-api";
import { getAuditLog } from "@/lib/dashboard-api";

export function useAuditLog(limit = 1000) {
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAuditLog(limit);
      if (!result) {
        setData(null);
        setError("Could not load audit log (try signing in again).");
        return;
      }
      setData(result);
    } catch {
      setError("Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}
