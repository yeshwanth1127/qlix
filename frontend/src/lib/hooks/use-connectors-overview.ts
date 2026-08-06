"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listConnectors,
  listLiveConnectors,
  type LiveConnectorItem,
} from "@/lib/connectors-api";

export function useConnectorsOverview() {
  const [liveConnectors, setLiveConnectors] = useState<LiveConnectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listConnectors();
      setLiveConnectors(listLiveConnectors(data.connectors));
    } catch (err) {
      setLiveConnectors([]);
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { liveConnectors, loading, error, refresh };
}
