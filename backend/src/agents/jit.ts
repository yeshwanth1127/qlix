import type { PermissionScope } from './agents.types.js';

export const FORCE_JIT_SCOPES: PermissionScope[] = [
  'web.transaction',
  'system.file_write',
  'system.gui_control',
  'finance.spend_50',
  'finance.spend_100',
];

export interface JitSplit {
  jitScopes: PermissionScope[];
  alwaysScopes: PermissionScope[];
}

export function enforceJitRules(
  scopes: PermissionScope[],
  requestedJit: PermissionScope[],
): JitSplit {
  const requestedSet = new Set(requestedJit);
  const jitScopes = scopes.filter(
    (scope) => FORCE_JIT_SCOPES.includes(scope) || requestedSet.has(scope),
  );
  const jitSet = new Set(jitScopes);
  const alwaysScopes = scopes.filter((scope) => !jitSet.has(scope));
  return { jitScopes, alwaysScopes };
}
