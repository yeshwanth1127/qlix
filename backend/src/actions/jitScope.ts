/**
 * Shared JIT-scope matching, used by both `/api/v1/actions/start` (enforcement) and
 * `/api/v1/jit/request` (gating). These two paths MUST agree: if they diverge, a tool
 * can be required-to-JIT at start but rejected at request time (or vice versa), which is
 * exactly what broke whole-server (`mcp.<slug>.*`) bindings before this was centralized.
 */

/**
 * Whether an actionType requires JIT approval given the agent's jitScopes.
 *
 * Exact match, plus MCP whole-server wildcard support: a jitScope of `mcp.<slug>.*`
 * covers every `mcp.<slug>.<tool>` actionType. The slug never contains a dot (it is
 * slugified to `[a-z0-9-]`), so the wildcard is always the first two dot-segments —
 * this stays correct even when the tool name itself contains dots (e.g.
 * `mcp.weather.get.current` ⇒ wildcard `mcp.weather.*`).
 */
export function scopeRequiresJit(jitScopes: string[], actionType: string): boolean {
  if (jitScopes.includes(actionType)) return true;
  if (actionType.startsWith('mcp.')) {
    const parts = actionType.split('.');
    if (parts.length >= 3) {
      const wildcard = `${parts[0]}.${parts[1]}.*`;
      if (jitScopes.includes(wildcard)) return true;
    }
  }
  return false;
}
