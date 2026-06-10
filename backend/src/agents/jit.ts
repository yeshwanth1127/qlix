import type { PermissionScope } from './agents.types.js';
import { FORCE_JIT_SCOPES } from './scopeCatalog.js';

// Re-exported for back-compat; the canonical list now lives in the scope catalog.
export { FORCE_JIT_SCOPES };

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
