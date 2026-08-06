import { createHash } from 'node:crypto';
import type { EmployeeRoleManifest } from './employees.types.js';

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const inner = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',');
  return `{${inner}}`;
}

/** Stable hash of a role manifest for hire snapshots and employment credentials. */
export function hashRoleManifest(manifest: EmployeeRoleManifest): string {
  return createHash('sha256').update(canonicalize(manifest)).digest('hex');
}
