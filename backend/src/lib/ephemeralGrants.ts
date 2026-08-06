import { prisma } from './prisma.js';

/**
 * DB-backed replacement for the several short-lived in-process `Map`s this codebase used
 * (WebAuthn challenges, JIT run-scoped grants, the lead-outreach gate) — each was safe only
 * because the backend runs as a single PM2 instance; any of them silently misbehaves the
 * moment a second instance or box joins. Backed by the `EphemeralGrant` table (namespace +
 * key, unique together) so it's correct regardless of instance count.
 *
 * NOTE: requires the `EphemeralGrant` table from `prisma/schema.prisma` — apply that
 * migration before switching a call site over to this.
 */

export async function ephemeralSet(namespace: string, key: string, value: unknown, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.ephemeralGrant.upsert({
    where: { namespace_key: { namespace, key } },
    update: { value: value === undefined ? undefined : (value as object), expiresAt },
    create: { namespace, key, value: value === undefined ? undefined : (value as object), expiresAt },
  });
}

export async function ephemeralGet<T = unknown>(namespace: string, key: string): Promise<T | null> {
  const row = await prisma.ephemeralGrant.findUnique({ where: { namespace_key: { namespace, key } } });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.ephemeralGrant.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }
  return (row.value ?? null) as T | null;
}

export async function ephemeralHas(namespace: string, key: string): Promise<boolean> {
  const row = await prisma.ephemeralGrant.findUnique({
    where: { namespace_key: { namespace, key } },
    select: { id: true, expiresAt: true },
  });
  if (!row) return false;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.ephemeralGrant.delete({ where: { id: row.id } }).catch(() => {});
    return false;
  }
  return true;
}

export async function ephemeralDelete(namespace: string, key: string): Promise<void> {
  await prisma.ephemeralGrant.deleteMany({ where: { namespace, key } });
}

/** Periodic sweep of expired rows — wired into `backgroundScheduler.ts`. */
export async function pruneExpiredEphemeralGrants(): Promise<number> {
  const result = await prisma.ephemeralGrant.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
