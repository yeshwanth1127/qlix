import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export const CONTEXT_REF_VERSION = 1 as const;
export const CONTEXT_EDGE_RELATIONS = ['supersedes', 'derived_from', 'references', 'produced_by'] as const;
export type ContextEdgeRelation = (typeof CONTEXT_EDGE_RELATIONS)[number];
const CONTEXT_REF_RE = /^ctx:([a-z0-9]+):v(\d+):([a-f0-9]{12})$/i;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_RESOLVE_REFS = 12;
const DEFAULT_RESOLVE_CHARS = 16_000;
const MAX_RESOLVE_CHARS = 64_000;

export interface CreateContextObjectInput {
  orgId: string;
  kind: string;
  sourceType: string;
  sourceId?: string | null;
  version?: number;
  content: unknown;
  summary?: unknown;
  metadata?: unknown;
  allowedAgentIds?: string[];
  readScopes?: string[];
  expiresAt?: Date | null;
  derivedFromRef?: string | null;
}

export interface ContextObjectRef {
  ref: string;
  id: string;
  version: number;
  contentHash: string;
  reused: boolean;
  contentChars: number;
}

export interface ResolveContextInput {
  orgId: string;
  agentId: string;
  grantedScopes: readonly string[];
  refs: string[];
  select?: string[];
  maxChars?: number;
}

interface CachedContextObject {
  expiresAtMs: number;
  value: Awaited<ReturnType<typeof loadContextObject>>;
}

const objectCache = new Map<string, CachedContextObject>();

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

export function formatContextRef(id: string, version: number, contentHash: string): string {
  return `ctx:${id}:v${version}:${contentHash.slice(0, 12)}`;
}

export function parseContextRef(ref: string): { id: string; version: number; hashPrefix: string } {
  const match = CONTEXT_REF_RE.exec(ref.trim());
  if (!match) throw new Error(`Invalid context reference: ${ref}`);
  return { id: match[1]!, version: Number(match[2]), hashPrefix: match[3]!.toLowerCase() };
}

function pathValue(value: unknown, path: string): unknown {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  let cursor = value;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export function selectContextFields(value: unknown, select: readonly string[]): unknown {
  if (select.length === 0) return value;
  const selected: Record<string, unknown> = {};
  for (const path of select) {
    if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) continue;
    const found = pathValue(value, path);
    if (found !== undefined) selected[path] = found;
  }
  return selected;
}

function clipJson(value: unknown, budget: number): { value: unknown; chars: number; truncated: boolean } {
  const text = JSON.stringify(value);
  if (text.length <= budget) return { value, chars: text.length, truncated: false };
  const preview = text.slice(0, Math.max(0, budget));
  return {
    value: { preview, originalChars: text.length, truncated: true },
    chars: preview.length,
    truncated: true,
  };
}

async function loadContextObject(id: string) {
  return prisma.contextObject.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: 'desc' }, take: 8 } },
  });
}

async function cachedFind(id: string) {
  const cached = objectCache.get(id);
  if (cached && cached.expiresAtMs > Date.now()) return cached.value;
  const value = await loadContextObject(id);
  objectCache.set(id, { value, expiresAtMs: Date.now() + CACHE_TTL_MS });
  return value;
}

async function ensureContextVersion(object: {
  id: string;
  orgId: string;
  version: number;
  contentHash: string;
  content: Prisma.JsonValue;
  summary: Prisma.JsonValue;
  metadata: Prisma.JsonValue;
}): Promise<void> {
  await prisma.contextVersion.upsert({
    where: { objectId_version: { objectId: object.id, version: object.version } },
    create: {
      objectId: object.id,
      orgId: object.orgId,
      version: object.version,
      contentHash: object.contentHash,
      content: object.content as Prisma.InputJsonValue,
      summary: object.summary as Prisma.InputJsonValue,
      metadata: object.metadata as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export async function linkContextEdge(input: {
  orgId: string;
  fromObjectId: string;
  toObjectId: string;
  relation: ContextEdgeRelation;
  metadata?: unknown;
}): Promise<{ created: boolean }> {
  if (input.fromObjectId === input.toObjectId) return { created: false };
  if (!(CONTEXT_EDGE_RELATIONS as readonly string[]).includes(input.relation)) {
    throw new Error(`Unsupported context edge relation: ${input.relation}`);
  }
  try {
    await prisma.contextEdge.create({
      data: {
        orgId: input.orgId,
        fromObjectId: input.fromObjectId,
        toObjectId: input.toObjectId,
        relation: input.relation,
        metadata: asJson(input.metadata),
      },
    });
    return { created: true };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002') {
      return { created: false };
    }
    throw error;
  }
}

export async function listContextLineage(orgId: string, objectId: string): Promise<{
  objectId: string;
  versions: Array<{ version: number; contentHash: string; createdAt: Date }>;
  edges: Array<{ relation: string; fromObjectId: string; toObjectId: string }>;
}> {
  const object = await prisma.contextObject.findFirst({
    where: { id: objectId, orgId },
    include: {
      versions: { orderBy: { version: 'asc' }, select: { version: true, contentHash: true, createdAt: true } },
      outgoingEdges: { select: { relation: true, fromObjectId: true, toObjectId: true } },
      incomingEdges: { select: { relation: true, fromObjectId: true, toObjectId: true } },
    },
  });
  if (!object) throw new Error(`Context object not found: ${objectId}`);
  return {
    objectId,
    versions: object.versions,
    edges: [...object.outgoingEdges, ...object.incomingEdges],
  };
}

/** Store immutable context once and reuse an identical source/version object. */
export async function createContextObject(input: CreateContextObjectInput): Promise<ContextObjectRef> {
  const version = Math.max(1, input.version ?? CONTEXT_REF_VERSION);
  const contentHash = sha256(input.content);
  const sourceId = input.sourceId?.trim() || null;
  const existing = await prisma.contextObject.findFirst({
    where: {
      orgId: input.orgId,
      kind: input.kind,
      sourceType: input.sourceType,
      sourceId,
      version,
      contentHash,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  const contentChars = JSON.stringify(input.content).length;
  if (existing) {
    await ensureContextVersion(existing);
    objectCache.set(existing.id, { value: await loadContextObject(existing.id), expiresAtMs: Date.now() + CACHE_TTL_MS });
    return {
      ref: formatContextRef(existing.id, existing.version, existing.contentHash),
      id: existing.id,
      version: existing.version,
      contentHash: existing.contentHash,
      reused: true,
      contentChars,
    };
  }
  const created = await prisma.contextObject.create({
    data: {
      orgId: input.orgId,
      kind: input.kind,
      sourceType: input.sourceType,
      sourceId,
      version,
      contentHash,
      content: asJson(input.content),
      summary: asJson(input.summary),
      metadata: asJson(input.metadata),
      allowedAgentIds: [...new Set(input.allowedAgentIds ?? [])],
      readScopes: [...new Set(input.readScopes ?? [])],
      expiresAt: input.expiresAt ?? null,
    },
  });
  await ensureContextVersion(created);
  if (sourceId) {
    const previous = await prisma.contextObject.findFirst({
      where: {
        orgId: input.orgId,
        kind: input.kind,
        sourceType: input.sourceType,
        sourceId,
        id: { not: created.id },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (previous) {
      await linkContextEdge({
        orgId: input.orgId,
        fromObjectId: created.id,
        toObjectId: previous.id,
        relation: 'supersedes',
      });
    }
  }
  if (input.derivedFromRef) {
    try {
      const parent = parseContextRef(input.derivedFromRef);
      await linkContextEdge({
        orgId: input.orgId,
        fromObjectId: created.id,
        toObjectId: parent.id,
        relation: 'derived_from',
      });
    } catch {
      // Invalid parent refs must not fail storing the new object.
    }
  }
  objectCache.set(created.id, { value: await loadContextObject(created.id), expiresAtMs: Date.now() + CACHE_TTL_MS });
  return {
    ref: formatContextRef(created.id, created.version, created.contentHash),
    id: created.id,
    version: created.version,
    contentHash: created.contentHash,
    reused: false,
    contentChars,
  };
}

/** Resolve several references in one call with ACL, field selection and a shared size budget. */
export async function resolveContextObjects(input: ResolveContextInput): Promise<{
  objects: Array<{ ref: string; kind: string; summary: unknown; content: unknown; truncated: boolean }>;
  requested: number;
  resolved: number;
  returnedChars: number;
  maxChars: number;
}> {
  const refs = [...new Set(input.refs.map((ref) => ref.trim()).filter(Boolean))];
  if (refs.length === 0 || refs.length > MAX_RESOLVE_REFS) {
    throw new Error(`context_get requires 1-${MAX_RESOLVE_REFS} unique references`);
  }
  const maxChars = Math.min(MAX_RESOLVE_CHARS, Math.max(1_000, input.maxChars ?? DEFAULT_RESOLVE_CHARS));
  let remaining = maxChars;
  const objects: Array<{ ref: string; kind: string; summary: unknown; content: unknown; truncated: boolean }> = [];
  for (const ref of refs) {
    const parsed = parseContextRef(ref);
    const object = await cachedFind(parsed.id);
    if (!object || object.orgId !== input.orgId) throw new Error(`Context reference not found: ${ref}`);
    if (object.version !== parsed.version && !object.versions.some((row) => row.version === parsed.version)) {
      throw new Error(`Context reference version/hash mismatch: ${ref}`);
    }
    const snapshot = object.versions.find((row) => row.version === parsed.version)
      ?? (object.version === parsed.version ? object : null);
    if (!snapshot || !snapshot.contentHash.startsWith(parsed.hashPrefix)) {
      throw new Error(`Context reference version/hash mismatch: ${ref}`);
    }
    if (object.expiresAt && object.expiresAt.getTime() <= Date.now()) throw new Error(`Context reference expired: ${ref}`);
    if (object.allowedAgentIds.length > 0 && !object.allowedAgentIds.includes(input.agentId)) {
      throw new Error(`Context reference is outside this agent's scope: ${ref}`);
    }
    const granted = new Set(input.grantedScopes);
    if (object.readScopes.some((scope) => !granted.has(scope))) {
      throw new Error(`Context reference requires additional scopes: ${ref}`);
    }
    const selected = selectContextFields(snapshot.content, input.select ?? []);
    const clipped = clipJson(selected, remaining);
    objects.push({ ref, kind: object.kind, summary: snapshot.summary, content: clipped.value, truncated: clipped.truncated });
    remaining = Math.max(0, remaining - clipped.chars);
    if (remaining === 0) break;
  }
  return {
    objects,
    requested: refs.length,
    resolved: objects.length,
    returnedChars: maxChars - remaining,
    maxChars,
  };
}

export function clearContextObjectCache(): void {
  objectCache.clear();
}
