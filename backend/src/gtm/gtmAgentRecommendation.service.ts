import { EMPLOYEE_ROLE_MANIFESTS, EMPLOYEE_ROLE_MANIFESTS_BY_SLUG } from '../employees/rolePacks.js';
import type { GtmIdeaPayload } from './discoveryFoundation.service.js';
import type { GtmCrmMode } from './gtmSetup.js';

export type GtmAgentMatchReasonCode =
  | 'discovery_stage'
  | 'b2b_audience'
  | 'inbound_support'
  | 'hiring_focus'
  | 'finance_ops'
  | 'people_ops'
  | 'crm_pipeline';

export interface GtmAgentMatchReason {
  code: GtmAgentMatchReasonCode;
  label: string;
}

export interface GtmAgentRecommendation {
  roleSlug: string;
  label: string;
  mission: string;
  rank: number;
  tier: 'primary' | 'secondary';
  score: number;
  matchReasons: GtmAgentMatchReason[];
  suggestedPlatforms: string[];
  suggestedPlaybookIds: string[];
  reason: string;
}

const SECONDARY_SCORE_GAP = 15;
const MIN_PRIMARY_SCORE = 25;

type RoleSlug = keyof typeof EMPLOYEE_ROLE_MANIFESTS_BY_SLUG;

const ROLE_SIGNALS: Record<RoleSlug, { keywords: string[]; baseScore: number; reasons: GtmAgentMatchReasonCode[] }> = {
  'sales-executive': {
    keywords: ['sell', 'sales', 'lead', 'pipeline', 'outreach', 'b2b', 'prospect', 'revenue', 'gtm', 'market', 'customer', 'business'],
    baseScore: 40,
    reasons: ['discovery_stage', 'b2b_audience'],
  },
  'customer-support': {
    keywords: ['support', 'ticket', 'helpdesk', 'customer service', 'faq', 'complaint', 'retention'],
    baseScore: 20,
    reasons: ['inbound_support'],
  },
  receptionist: {
    keywords: ['inbox', 'triage', 'front desk', 'reception', 'routing', 'messages', 'whatsapp'],
    baseScore: 18,
    reasons: ['inbound_support'],
  },
  recruiter: {
    keywords: ['recruit', 'hiring', 'candidate', 'talent', 'hr hire', 'job', 'interview'],
    baseScore: 22,
    reasons: ['hiring_focus'],
  },
  accountant: {
    keywords: ['invoice', 'bookkeeping', 'accounting', 'payable', 'receivable', 'finance', 'expense'],
    baseScore: 18,
    reasons: ['finance_ops'],
  },
  'hr-manager': {
    keywords: ['onboarding', 'policy', 'employee', 'people ops', 'hr', 'payroll', 'benefits'],
    baseScore: 16,
    reasons: ['people_ops'],
  },
};

function corpus(content: GtmIdeaPayload): string {
  return [content.idea, content.problem, content.audience, content.solution, content.outcome, content.constraints]
    .join(' ')
    .toLowerCase();
}

function countKeywordHits(text: string, keywords: readonly string[]): number {
  let hits = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) hits += 1;
  }
  return hits;
}

function reasonLabel(code: GtmAgentMatchReasonCode): string {
  switch (code) {
    case 'discovery_stage':
      return 'Early GTM — you need lead research before outreach';
    case 'b2b_audience':
      return 'Your audience looks like businesses, not consumers';
    case 'inbound_support':
      return 'Your idea involves handling inbound customer volume';
    case 'hiring_focus':
      return 'Recruiting or talent workflows are part of this idea';
    case 'finance_ops':
      return 'Finance or billing workflows are central to the idea';
    case 'people_ops':
      return 'HR or people operations are part of the workflow';
    case 'crm_pipeline':
      return 'A CRM pipeline will track discovery progress';
    default:
      return 'This role fits your stated goals';
  }
}

function buildReasons(codes: GtmAgentMatchReasonCode[], text: string, crmMode: GtmCrmMode): GtmAgentMatchReason[] {
  const reasons: GtmAgentMatchReason[] = [];
  for (const code of codes) {
    reasons.push({ code, label: reasonLabel(code) });
  }
  if (crmMode !== 'undecided' && (text.includes('pipeline') || text.includes('crm') || text.includes('lead'))) {
    reasons.push({ code: 'crm_pipeline', label: reasonLabel('crm_pipeline') });
  }
  return reasons.slice(0, 3);
}

function scoreRole(slug: RoleSlug, text: string, crmMode: GtmCrmMode): number {
  const signals = ROLE_SIGNALS[slug];
  const hits = countKeywordHits(text, signals.keywords);
  let score = signals.baseScore + hits * 8;
  if (slug === 'sales-executive' && !text.trim()) score += 20;
  if (slug === 'sales-executive' && /\bb2b\b|business|company|enterprise|startup/.test(text)) score += 12;
  if (crmMode === 'external' || crmMode === 'qlix_twenty') {
    if (slug === 'sales-executive') score += 5;
  }
  return score;
}

export function recommendGtmAgents(input: {
  content: GtmIdeaPayload;
  crmMode?: GtmCrmMode;
}): GtmAgentRecommendation[] {
  const text = corpus(input.content);
  const crmMode = input.crmMode ?? 'undecided';

  const ranked = EMPLOYEE_ROLE_MANIFESTS.map((manifest) => {
    const slug = manifest.slug as RoleSlug;
    const score = scoreRole(slug, text, crmMode);
    const matchReasons = buildReasons(ROLE_SIGNALS[slug].reasons, text, crmMode);
    const suggestedPlatforms = manifest.platformSuggestions.map((s) => s.platformId);
    const suggestedPlaybookIds = manifest.playbooks.slice(0, 2).map((p) => p.id);
    return {
      roleSlug: manifest.slug,
      label: manifest.label,
      mission: manifest.mission,
      rank: 0,
      tier: 'secondary' as const,
      score,
      matchReasons,
      suggestedPlatforms,
      suggestedPlaybookIds,
      reason: matchReasons.map((r) => r.label).join('. '),
    };
  }).sort((a, b) => b.score - a.score);

  const primary = ranked[0]?.score >= MIN_PRIMARY_SCORE ? ranked[0] : {
    ...ranked.find((r) => r.roleSlug === 'sales-executive') ?? ranked[0]!,
    score: Math.max(ranked.find((r) => r.roleSlug === 'sales-executive')?.score ?? 0, MIN_PRIMARY_SCORE),
  };

  const primarySlug = primary.roleSlug;
  const results: GtmAgentRecommendation[] = [{
    ...primary,
    rank: 1,
    tier: 'primary',
  }];

  for (const candidate of ranked) {
    if (candidate.roleSlug === primarySlug) continue;
    if (primary.score - candidate.score > SECONDARY_SCORE_GAP) continue;
    if (results.length >= 3) break;
    results.push({
      ...candidate,
      rank: results.length + 1,
      tier: 'secondary',
    });
  }

  return results;
}

export function allowedAgentSlugs(recommendations: GtmAgentRecommendation[]): Set<string> {
  return new Set(recommendations.map((r) => r.roleSlug));
}

export function mergePlanAgentsWithRecommendations(
  llmAgents: Array<{ roleSlug: string; label: string; reason: string }>,
  recommendations: GtmAgentRecommendation[],
): GtmAgentRecommendation[] {
  const bySlug = new Map(recommendations.map((r) => [r.roleSlug, r]));
  const merged: GtmAgentRecommendation[] = [];

  for (const agent of llmAgents) {
    const rec = bySlug.get(agent.roleSlug);
    if (!rec) continue;
    merged.push({
      ...rec,
      reason: agent.reason.trim() || rec.reason,
    });
  }

  if (merged.length === 0) return recommendations;
  const primary = merged.find((a) => a.tier === 'primary') ?? merged[0];
  return [
    { ...primary, tier: 'primary', rank: 1 },
    ...merged.filter((a) => a.roleSlug !== primary.roleSlug).slice(0, 2).map((a, i) => ({
      ...a,
      tier: 'secondary' as const,
      rank: i + 2,
    })),
  ];
}
