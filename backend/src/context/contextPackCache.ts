import crypto from 'node:crypto';
import type { BrainContextLoad } from './brainContextAdapter.js';
import type { ContextPack } from './contextContracts.js';
import { compileContextPack, type CompileContextPackInput } from './contextResolver.js';

const PACK_CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 500;

export interface ContextPackCacheSources {
  runId: string;
  orgId: string | null;
  agentId: string;
  taskText: string;
  memoryText: string | null;
  useBrain: boolean;
  /** Latest Brain document id + updatedAt, or `none` / `empty` when unused. */
  brainSourceVersion: string;
  /** Tenant + agent identity that may read this pack. */
  permissionFingerprint: string;
  maxInlineTokens?: number;
  maxReferences?: number;
}

interface CachedPack {
  pack: ContextPack;
  expiresAtMs: number;
}

const packCache = new Map<string, CachedPack>();

function fingerprint(sources: ContextPackCacheSources): string {
  return [
    sources.runId,
    sources.orgId ?? '',
    sources.agentId,
    sources.permissionFingerprint,
    sources.taskText,
    sources.memoryText ?? '',
    sources.useBrain ? '1' : '0',
    sources.brainSourceVersion,
    String(sources.maxInlineTokens ?? ''),
    String(sources.maxReferences ?? ''),
  ].join('\u001f');
}

export function contextPackCacheKey(sources: ContextPackCacheSources): string {
  return crypto.createHash('sha256').update(fingerprint(sources)).digest('hex');
}

export function getCachedContextPack(key: string): ContextPack | null {
  const entry = packCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    packCache.delete(key);
    return null;
  }
  return entry.pack;
}

export function setCachedContextPack(key: string, pack: ContextPack, ttlMs = PACK_CACHE_TTL_MS): void {
  if (packCache.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [cachedKey, entry] of packCache) {
      if (entry.expiresAtMs <= now) packCache.delete(cachedKey);
    }
    if (packCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = packCache.keys().next().value;
      if (oldest) packCache.delete(oldest);
    }
  }
  packCache.set(key, { pack, expiresAtMs: Date.now() + Math.max(1_000, ttlMs) });
}

export function clearContextPackCache(): void {
  packCache.clear();
}

function isRunnerFallback(pack: ContextPack): boolean {
  return pack.omitted.some((item) => item.component === 'brain' && item.reason === 'runner_fallback');
}

/**
 * Compile once per request + source versions + permissions so stale-run
 * recovery does not re-query Brain (Layer 5 audit / usage) for the same pack.
 */
export async function getOrCompileCachedContextPack(input: {
  sources: ContextPackCacheSources;
  compile: Omit<CompileContextPackInput, 'brainText' | 'brainOwned' | 'brainCitations'>;
  loadBrain?: () => Promise<BrainContextLoad>;
}): Promise<{ pack: ContextPack; cacheHit: boolean; brainLoaded: boolean }> {
  const key = contextPackCacheKey(input.sources);
  const cached = getCachedContextPack(key);
  if (cached) return { pack: cached, cacheHit: true, brainLoaded: false };

  let brainOwned = false;
  let brainText: string | null = null;
  let brainCitations: unknown;
  let brainLoaded = false;
  if (input.sources.useBrain && input.loadBrain) {
    const loaded = await input.loadBrain();
    brainLoaded = true;
    if (!loaded.failed) {
      brainOwned = true;
      brainText = loaded.text;
      brainCitations = loaded.citations;
    }
  }

  const pack = await compileContextPack({
    ...input.compile,
    brainText,
    brainOwned,
    brainCitations,
  });
  if (!isRunnerFallback(pack)) setCachedContextPack(key, pack);
  return { pack, cacheHit: false, brainLoaded };
}
