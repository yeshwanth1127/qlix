/**
 * Developer API key scopes — least-privilege grants for `qlix_live_*` credentials.
 * Session JWT auth bypasses these checks (console keeps full access).
 */

export const API_KEY_SCOPES = [
  'agents:read',
  'agents:write',
  'audit:read',
  'credentials:read',
  'runs:write',
  'teams:read',
  'teams:write',
  'brain:read',
  'brain:write',
  'jit:decide',
  'usage:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const ALL_API_KEY_SCOPES: readonly ApiKeyScope[] = API_KEY_SCOPES;

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

export function normalizeApiKeyScopes(input: unknown): ApiKeyScope[] {
  if (!Array.isArray(input)) return [...ALL_API_KEY_SCOPES];
  const out: ApiKeyScope[] = [];
  for (const item of input) {
    if (typeof item === 'string' && isApiKeyScope(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out.length > 0 ? out : [...ALL_API_KEY_SCOPES];
}

export function apiKeyHasScopes(
  granted: readonly string[] | undefined,
  required: readonly ApiKeyScope[],
): boolean {
  if (required.length === 0) return true;
  const set = new Set(granted ?? []);
  return required.every((scope) => set.has(scope));
}

export const API_KEY_PREFIX = 'qlix_live_';

export function isApiKeyCredential(raw: string): boolean {
  return raw.startsWith(API_KEY_PREFIX);
}

type ScopeRule = {
  methods: readonly string[];
  /** Match against pathname (no query), e.g. `/api/v1/agents`. */
  pattern: RegExp;
  scopes: readonly ApiKeyScope[];
};

/**
 * Allowlist of developer API routes for API-key auth.
 * More specific patterns must appear before broader ones.
 * Unlisted authenticated routes reject API keys (session JWT still works).
 */
const DEVELOPER_API_SCOPE_RULES: readonly ScopeRule[] = [
  // Agent runs (chat enqueue / stream / control)
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/conversations\/?$/,
    scopes: ['runs:write'],
  },
  {
    methods: ['GET', 'DELETE'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/conversations\/[^/]+\/messages\/?$/,
    scopes: ['runs:write'],
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/conversations\/[^/]+\/messages\/?$/,
    scopes: ['runs:write'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/runs\/[^/]+\/stream\/?$/,
    scopes: ['runs:write'],
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/runs\/[^/]+\/(stop|inject)\/?$/,
    scopes: ['runs:write'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/agents\/(active-runs|run-history)\/?$/,
    scopes: ['runs:write'],
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/brain\/query\/?$/,
    scopes: ['brain:read'],
  },

  // Agents (Layer 3)
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/agents\/scope-catalog\/?$/,
    scopes: ['agents:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/agents\/?$/,
    scopes: ['agents:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/?$/,
    scopes: ['agents:read'],
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/agents\/?$/,
    scopes: ['agents:write'],
  },
  {
    methods: ['PATCH'],
    pattern: /^\/api\/v1\/agents\/[^/]+\/(scopes|description|tool-profile)\/?$/,
    scopes: ['agents:write'],
  },
  {
    methods: ['DELETE'],
    pattern: /^\/api\/v1\/agents(\/[^/]+)?\/?$/,
    scopes: ['agents:write'],
  },

  // Credentials / passports
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/credentials\/?$/,
    scopes: ['credentials:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/passports\/?$/,
    scopes: ['credentials:read'],
  },

  // Audit / compliance (Layer 5 read)
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/dashboard\/audit\/?$/,
    scopes: ['audit:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/compliance\/export\/?$/,
    scopes: ['audit:read'],
  },

  // JIT (human decide / grants)
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/jit\/decide\/?$/,
    scopes: ['jit:decide'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/jit\/(grants|pending)\/?$/,
    scopes: ['jit:decide'],
  },
  {
    methods: ['DELETE'],
    pattern: /^\/api\/v1\/jit\/grants\/[^/]+\/?$/,
    scopes: ['jit:decide'],
  },

  // Teams
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/teams\/?$/,
    scopes: ['teams:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/teams\/[^/]+(\/runners-status)?\/?$/,
    scopes: ['teams:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/teams\/[^/]+\/runs(\/[^/]+)?\/?$/,
    scopes: ['teams:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/teams\/[^/]+\/runs\/[^/]+\/stream\/?$/,
    scopes: ['teams:read'],
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/teams\/?$/,
    scopes: ['teams:write'],
  },
  {
    methods: ['POST', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/teams\/[^/]+(\/.*)?\/?$/,
    scopes: ['teams:write'],
  },

  // AI Brain
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/ai-brain\/(status|documents|collections|policy-signals)\/?$/,
    scopes: ['brain:read'],
  },
  {
    methods: ['POST'],
    pattern: /^\/api\/v1\/ai-brain\/query\/?$/,
    scopes: ['brain:read'],
  },
  {
    methods: ['POST', 'PATCH', 'DELETE'],
    pattern: /^\/api\/v1\/ai-brain(\/.*)?\/?$/,
    scopes: ['brain:write'],
  },

  // Org / usage (supporting)
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/organization\/members\/?$/,
    scopes: ['agents:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/usage(\/.*)?\/?$/,
    scopes: ['usage:read'],
  },
  {
    methods: ['GET'],
    pattern: /^\/api\/v1\/billing\/subscription\/?$/,
    scopes: ['usage:read'],
  },
];

export type ApiKeyRouteAccess =
  | { allowed: true; scopes: readonly ApiKeyScope[] }
  | { allowed: false; reason: 'not_in_developer_api' };

/**
 * Resolve whether an API key may call this path and which scopes are required.
 */
export function resolveApiKeyRouteAccess(method: string, originalUrl: string): ApiKeyRouteAccess {
  const pathOnly = originalUrl.split('?')[0] ?? originalUrl;
  const normalizedMethod = method.toUpperCase();
  for (const rule of DEVELOPER_API_SCOPE_RULES) {
    if (!rule.methods.includes(normalizedMethod)) continue;
    if (rule.pattern.test(pathOnly)) {
      return { allowed: true, scopes: rule.scopes };
    }
  }
  return { allowed: false, reason: 'not_in_developer_api' };
}
