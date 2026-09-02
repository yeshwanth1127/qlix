/**
 * Narrow the scope catalog shown in the NL builder system prompt based on user intent.
 * Sanitization and post-plan enrichment still use the full org buildable set.
 */
import type { ScopeDef } from './scopeCatalog.js';
import { selectNlPromptPacks, type NlPromptPackId } from './nlPromptPacks.js';
import { isSchedulePrompt } from './nlPlanEnrichment.js';

const ALWAYS_INCLUDE = new Set(['brain.query']);

const PACK_SCOPE_PATTERNS: Record<NlPromptPackId, readonly (string | RegExp)[]> = {
  jobs: ['web.read', 'web.click', 'web.transaction', /^mcp\.qlix-jobs\./],
  competitor: ['web.research', 'brain.query', 'files.create', 'brain.knowledge_read'],
  crm: [/^crm\./],
  slack: [/^slack\./],
  notion: [/^notion\./],
  local: [/^system\.file_/, 'system.gui_control', 'web.read', 'web.click', 'web.transaction'],
  finance: [/^finance\.spend_/],
  messaging: [
    /^email\./,
    /^drive\./,
    /^docs\./,
    /^sheets\./,
    /^slides\./,
    /^forms\./,
    /^calendar\./,
    'meet.manage',
    /^youtube\./,
    /^whatsapp\./,
    /^social\./,
  ],
};

const CORE_FALLBACK = [
  'brain.query',
  'web.read',
  'web.research',
  'web.click',
  'files.create',
  'brain.knowledge_read',
] as const;

function scopeMatchesPatterns(id: string, patterns: readonly (string | RegExp)[]): boolean {
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? id === pattern : pattern.test(id),
  );
}

function patternsForPrompt(prompt: string): (string | RegExp)[] {
  const patterns: (string | RegExp)[] = [...ALWAYS_INCLUDE];
  for (const pack of selectNlPromptPacks(prompt)) {
    patterns.push(...PACK_SCOPE_PATTERNS[pack]);
  }
  if (isSchedulePrompt(prompt)) {
    patterns.push(/^mcp\.qlix-schedule\./);
  }
  if (/\b(ask\s+(?:another\s+)?agent|delegate\s+to|peer\s+agent|other\s+agent)\b/i.test(prompt)) {
    patterns.push(/^agent\.ask\./);
  }
  if (/\b(assessment|examiner|work\s+session|readiness\s+report)\b/i.test(prompt)) {
    patterns.push(/^assessment\./);
  }
  return patterns;
}

/** MCP tools whose server slug appears in the user prompt (e.g. "qlix-jobs"). */
function mcpScopesMentionedInPrompt(prompt: string, scopes: ScopeDef[]): ScopeDef[] {
  const lower = prompt.toLowerCase();
  return scopes.filter((scope) => {
    if (!scope.id.startsWith('mcp.')) return false;
    const slug = scope.id.split('.')[1];
    return slug ? lower.includes(slug.replace(/-/g, ' ')) || lower.includes(slug) : false;
  });
}

function withoutScheduleUnlessIntent(prompt: string, scopes: ScopeDef[]): ScopeDef[] {
  if (isSchedulePrompt(prompt)) return scopes;
  return scopes.filter((scope) => !scope.id.startsWith('mcp.qlix-schedule.'));
}

/**
 * Return a subset of buildable scopes for the builder system prompt.
 * Domain-specific intents return matched scopes plus a small core set; vague prompts
 * fall back to core web scopes (never qlix-schedule unless intent matches).
 */
export function filterScopesForBuilderPrompt(
  prompt: string,
  scopes: ScopeDef[],
): ScopeDef[] {
  const packs = selectNlPromptPacks(prompt);
  const patterns = patternsForPrompt(prompt);
  const byIntent = scopes.filter((scope) => scopeMatchesPatterns(scope.id, patterns));
  const mentionedMcp = mcpScopesMentionedInPrompt(prompt, scopes);
  const merged = new Map<string, ScopeDef>();
  for (const scope of [...byIntent, ...mentionedMcp]) {
    merged.set(scope.id, scope);
  }
  const matched = [...merged.values()];

  const hasDomainIntent =
    packs.length > 0 || isSchedulePrompt(prompt) || mentionedMcp.length > 0;

  if (hasDomainIntent) {
    const core = scopes.filter((scope) =>
      CORE_FALLBACK.includes(scope.id as (typeof CORE_FALLBACK)[number]),
    );
    const union = new Map<string, ScopeDef>();
    for (const scope of [...matched, ...core]) {
      union.set(scope.id, scope);
    }
    return withoutScheduleUnlessIntent(prompt, [...union.values()]);
  }

  if (matched.length >= 6) return withoutScheduleUnlessIntent(prompt, matched);

  const withCore = scopes.filter(
    (scope) => CORE_FALLBACK.includes(scope.id as (typeof CORE_FALLBACK)[number])
      || matched.some((item) => item.id === scope.id),
  );
  if (withCore.length >= 6) return withoutScheduleUnlessIntent(prompt, withCore);

  return withoutScheduleUnlessIntent(prompt, withCore.length ? withCore : scopes);
}
