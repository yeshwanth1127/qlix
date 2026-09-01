import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type ExecutionKind = 'agent_run' | 'team_run';

export interface StatePatchOperation {
  op: 'set' | 'merge';
  path: string;
  value: unknown;
}

export interface EnsureRunStateInput {
  orgId: string;
  executionId: string;
  executionKind: ExecutionKind;
  namespaces?: Record<string, unknown>;
}

export interface PatchRunStateInput {
  orgId: string;
  executionId: string;
  executionKind: ExecutionKind;
  baseVersion: number;
  operations: StatePatchOperation[];
  idempotencyKey?: string;
  allowedPrefixes?: string[];
}

const PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const MAX_PATCH_OPS = 16;
const MAX_APPLIED_KEYS = 200;

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function cloneNamespaces(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

export function applyStateOperations(
  namespaces: unknown,
  operations: StatePatchOperation[],
): Record<string, unknown> {
  const next = cloneNamespaces(namespaces);
  for (const operation of operations) {
    if (operation.op === 'set') setPath(next, operation.path, operation.value);
    else mergePath(next, operation.path, operation.value);
  }
  return next;
}

export function isStatePathAllowed(path: string, allowedPrefixes?: string[]): boolean {
  return pathAllowed(path, allowedPrefixes);
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

function mergePath(root: Record<string, unknown>, path: string, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    setPath(root, path, value);
    return;
  }
  const parts = path.split('.');
  let cursor: Record<string, unknown> = root;
  for (const key of parts) {
    const next = cursor[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  Object.assign(cursor, value as Record<string, unknown>);
}

function pathAllowed(path: string, allowedPrefixes?: string[]): boolean {
  if (!allowedPrefixes || allowedPrefixes.length === 0) return true;
  return allowedPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));
}

export async function ensureRunState(input: EnsureRunStateInput) {
  const existing = await prisma.executionRunState.findUnique({
    where: {
      executionKind_executionId: {
        executionKind: input.executionKind,
        executionId: input.executionId,
      },
    },
  });
  if (existing) return existing;
  return prisma.executionRunState.create({
    data: {
      orgId: input.orgId,
      executionId: input.executionId,
      executionKind: input.executionKind,
      namespaces: asJson(input.namespaces ?? {}),
    },
  });
}

export async function readRunState(input: {
  orgId: string;
  executionId: string;
  executionKind: ExecutionKind;
  select?: string[];
}) {
  const row = await prisma.executionRunState.findUnique({
    where: {
      executionKind_executionId: {
        executionKind: input.executionKind,
        executionId: input.executionId,
      },
    },
  });
  if (!row || row.orgId !== input.orgId) return null;
  const namespaces = cloneNamespaces(row.namespaces);
  if (!input.select || input.select.length === 0) {
    return { version: row.version, namespaces };
  }
  const selected: Record<string, unknown> = {};
  for (const path of input.select) {
    if (!PATH_RE.test(path)) continue;
    const parts = path.split('.');
    let cursor: unknown = namespaces;
    for (const part of parts) {
      if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[part];
    }
    if (cursor !== undefined) selected[path] = cursor;
  }
  return { version: row.version, namespaces: selected };
}

export async function patchRunStateWithRetry(input: Omit<PatchRunStateInput, 'baseVersion'> & { attempts?: number }) {
  const attempts = Math.max(1, input.attempts ?? 3);
  let lastError: Error | null = null;
  for (let i = 0; i < attempts; i += 1) {
    const current = await readRunState({
      orgId: input.orgId,
      executionId: input.executionId,
      executionKind: input.executionKind,
    });
    if (!current) {
      await ensureRunState({
        orgId: input.orgId,
        executionId: input.executionId,
        executionKind: input.executionKind,
      });
      continue;
    }
    try {
      return await patchRunState({ ...input, baseVersion: current.version });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if ((error as { code?: string }).code !== 'state_version_conflict') throw error;
    }
  }
  throw lastError ?? new Error('State patch failed');
}

export async function patchRunState(input: PatchRunStateInput) {
  if (input.operations.length === 0 || input.operations.length > MAX_PATCH_OPS) {
    throw new Error(`state.patch requires 1-${MAX_PATCH_OPS} operations`);
  }
  for (const operation of input.operations) {
    if (operation.op !== 'set' && operation.op !== 'merge') throw new Error('Unsupported state patch op');
    if (!PATH_RE.test(operation.path)) throw new Error(`Invalid state path: ${operation.path}`);
    if (!pathAllowed(operation.path, input.allowedPrefixes)) {
      throw new Error(`State path is outside this agent's grant: ${operation.path}`);
    }
  }

  const current = await ensureRunState({
    orgId: input.orgId,
    executionId: input.executionId,
    executionKind: input.executionKind,
  });
  const idempotencyKey = input.idempotencyKey?.trim();
  if (idempotencyKey && current.appliedPatchKeys.includes(idempotencyKey)) {
    return { version: current.version, namespaces: cloneNamespaces(current.namespaces), reused: true };
  }
  if (current.version !== input.baseVersion) {
    const error = new Error(`State version conflict: expected ${input.baseVersion}, found ${current.version}`);
    (error as Error & { code?: string }).code = 'state_version_conflict';
    throw error;
  }

  const namespaces = applyStateOperations(current.namespaces, input.operations);
  const applied = idempotencyKey
    ? [...current.appliedPatchKeys, idempotencyKey].slice(-MAX_APPLIED_KEYS)
    : current.appliedPatchKeys;

  const updated = await prisma.executionRunState.update({
    where: { id: current.id, version: current.version },
    data: {
      version: { increment: 1 },
      namespaces: asJson(namespaces),
      appliedPatchKeys: applied,
    },
  });
  return { version: updated.version, namespaces: cloneNamespaces(updated.namespaces), reused: false };
}
