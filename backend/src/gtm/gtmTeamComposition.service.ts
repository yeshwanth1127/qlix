import { EMPLOYEE_ROLE_MANIFESTS_BY_SLUG } from '../employees/rolePacks.js';
import type { GtmIdeaPayload } from './discoveryFoundation.service.js';
import {
  recommendGtmAgents,
  type GtmAgentMatchReason,
  type GtmAgentRecommendation,
} from './gtmAgentRecommendation.service.js';
import type { GtmCrmMode } from './gtmSetup.js';

export type GtmTeamSlotId = 'research' | 'email' | 'outreach' | 'support';

export interface GtmTeamSlot {
  slotId: GtmTeamSlotId;
  slotLabel: string;
  roleSlug: string;
  roleLabel: string;
  mission: string;
  parallel: true;
  matchReasons: GtmAgentMatchReason[];
  suggestedPlatforms: string[];
  suggestedPlaybookIds: string[];
  suggestedName: string;
}

const SLOT_DEFAULTS: Record<GtmTeamSlotId, { slotLabel: string; roleSlug: string; suggestedName: string }> = {
  research: { slotLabel: 'Research agent', roleSlug: 'sales-executive', suggestedName: 'Research Lead' },
  email: { slotLabel: 'Email agent', roleSlug: 'receptionist', suggestedName: 'Inbox Agent' },
  outreach: { slotLabel: 'Outreach agent', roleSlug: 'sales-executive', suggestedName: 'Discovery Lead' },
  support: { slotLabel: 'Support agent', roleSlug: 'customer-support', suggestedName: 'Support Lead' },
};

function manifestFor(slug: string) {
  return EMPLOYEE_ROLE_MANIFESTS_BY_SLUG[slug as keyof typeof EMPLOYEE_ROLE_MANIFESTS_BY_SLUG];
}

function slotFromRecommendation(
  slotId: GtmTeamSlotId,
  recommendation: GtmAgentRecommendation | undefined,
  fallbackSlug: string,
): GtmTeamSlot {
  const defaults = SLOT_DEFAULTS[slotId];
  const slug = recommendation?.roleSlug ?? fallbackSlug;
  const manifest = manifestFor(slug);
  return {
    slotId,
    slotLabel: defaults.slotLabel,
    roleSlug: slug,
    roleLabel: recommendation?.label ?? manifest?.label ?? defaults.slotLabel,
    mission: recommendation?.mission ?? manifest?.mission ?? 'Runs discovery workflows in parallel with your team.',
    parallel: true,
    matchReasons: recommendation?.matchReasons ?? [],
    suggestedPlatforms: recommendation?.suggestedPlatforms ?? manifest?.platformSuggestions.map((s) => s.platformId) ?? ['google'],
    suggestedPlaybookIds: recommendation?.suggestedPlaybookIds ?? manifest?.playbooks.slice(0, 2).map((p) => p.id) ?? [],
    suggestedName: defaults.suggestedName,
  };
}

export function recommendGtmTeam(input: {
  content: GtmIdeaPayload;
  crmMode?: GtmCrmMode;
  planTools?: Array<{ capabilityId: string; priority: string }>;
}): GtmTeamSlot[] {
  const recommendations = recommendGtmAgents(input);
  const bySlug = new Map(recommendations.map((r) => [r.roleSlug, r]));
  const text = [input.content.idea, input.content.audience, input.content.problem].join(' ').toLowerCase();

  const slots: GtmTeamSlot[] = [];

  slots.push(slotFromRecommendation('research', bySlug.get('sales-executive') ?? recommendations[0], 'sales-executive'));
  slots.push(slotFromRecommendation('email', bySlug.get('receptionist'), 'receptionist'));

  const needsSupport = bySlug.has('customer-support')
    || /support|ticket|customer service|helpdesk|faq/.test(text);
  if (needsSupport) {
    slots.push(slotFromRecommendation('support', bySlug.get('customer-support'), 'customer-support'));
  }

  const outreachRec = recommendations.find((r) =>
    r.roleSlug === 'sales-executive' && r.tier === 'primary',
  );
  const hasDistinctOutreach = input.planTools?.some((t) => t.capabilityId === 'crm' && t.priority === 'now');
  if (hasDistinctOutreach && !slots.some((s) => s.slotId === 'outreach')) {
    slots.push(slotFromRecommendation('outreach', outreachRec, 'sales-executive'));
  }

  for (const rec of recommendations) {
    if (slots.length >= 4) break;
    if (slots.some((s) => s.roleSlug === rec.roleSlug)) continue;
    if (rec.roleSlug === 'sales-executive' || rec.roleSlug === 'receptionist') continue;
    slots.push({
      ...slotFromRecommendation('support', rec, rec.roleSlug),
      slotId: 'support',
      slotLabel: `${rec.label} agent`,
      suggestedName: rec.label,
    });
  }

  return slots.slice(0, 4);
}

export function teamHireProgress(slots: GtmTeamSlot[], hiredRoleSlugs: readonly string[]): {
  hiredCount: number;
  totalCount: number;
  nextSlot: GtmTeamSlot | null;
  allHired: boolean;
} {
  const hiredCount = slots.filter((s) => hiredRoleSlugs.includes(s.roleSlug)).length;
  const nextSlot = slots.find((s) => !hiredRoleSlugs.includes(s.roleSlug)) ?? null;
  return {
    hiredCount,
    totalCount: slots.length,
    nextSlot,
    allHired: hiredCount >= slots.length,
  };
}
