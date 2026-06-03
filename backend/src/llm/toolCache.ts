/**
 * In-memory cache for tool definitions keyed by agent + hash.
 *
 * OPTIMIZATION: Cloud runner sends tools only on round 1, then tools_hash on rounds 2+.
 * This backend cache re-injects tools when needed so OpenRouter always has them.
 *
 * Entries expire after 1 hour (per-conversation, 12 rounds max typically).
 */

interface CachedTools {
  tools: unknown[];
  timestamp: number;
}

// Map structure: agentId_toolsHash -> { tools, timestamp }
const toolCache = new Map<string, CachedTools>();

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function cacheToolDefinitions(agentId: string, toolsHash: string, tools: unknown[]): void {
  const key = `${agentId}_${toolsHash}`;
  toolCache.set(key, {
    tools,
    timestamp: Date.now(),
  });
}

export function getCachedTools(agentId: string, toolsHash: string): unknown[] | null {
  const key = `${agentId}_${toolsHash}`;
  const cached = toolCache.get(key);

  if (!cached) {
    return null;
  }

  // Check if expired
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    toolCache.delete(key);
    return null;
  }

  return cached.tools;
}

export function invalidateToolCache(agentId: string): void {
  // Clear all caches for this agent (e.g., if tools changed)
  for (const key of toolCache.keys()) {
    if (key.startsWith(`${agentId}_`)) {
      toolCache.delete(key);
    }
  }
}

export function cleanupExpiredCaches(): void {
  // Run periodically (e.g., every 10 minutes) to clean old entries
  const now = Date.now();
  for (const [key, cached] of toolCache.entries()) {
    if (now - cached.timestamp > CACHE_TTL_MS) {
      toolCache.delete(key);
    }
  }
}
