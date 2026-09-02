/**
 * Named pipeline job types. Scopes come from kind + channel, not from sniffing
 * the user's paragraph.
 */
import type { PermissionScope } from '../agents/agents.types.js';
import { withDefaultAgentScopes } from '../agents/defaultAgentScopes.js';
import type { NLAgentSpec, NLWorkerSpec } from '../agents/nlTypes.js';
import type { AgentCreationPlan } from '../agents/nlTypes.js';

export const STAGE_KINDS = ['source', 'transform', 'act', 'wait', 'deliver'] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_CHANNELS = [
  'whatsapp',
  'email',
  'slack',
  'crm',
  'notion',
  'web',
  'files',
] as const;
export type StageChannel = (typeof STAGE_CHANNELS)[number];

export interface StageContract {
  stageKind: StageKind;
  alsoKinds: StageKind[];
  channels: StageChannel[];
}

const CHANNEL_ACT_SCOPES: Record<StageChannel, readonly PermissionScope[]> = {
  whatsapp: ['whatsapp.contact_send'],
  email: ['email.send'],
  slack: ['slack.send'],
  crm: ['crm.read', 'crm.write'],
  notion: ['notion.read', 'notion.write'],
  web: ['web.read', 'web.click', 'web.research'],
  files: ['system.file_read', 'system.file_write'],
};

const CHANNEL_WAIT_SCOPES: Record<StageChannel, readonly PermissionScope[]> = {
  whatsapp: ['whatsapp.auto_reply'],
  email: ['email.read'],
  slack: ['slack.read'],
  crm: ['crm.read'],
  notion: ['notion.read'],
  web: [],
  files: [],
};

const CHANNEL_DELIVER_SCOPES: Record<StageChannel, readonly PermissionScope[]> = {
  whatsapp: ['whatsapp.send', 'files.create'],
  email: ['email.send', 'files.create'],
  slack: ['slack.send', 'files.create'],
  crm: ['files.create'],
  notion: ['notion.write'],
  web: ['files.create'],
  files: ['files.create'],
};

/** Compact names the model should see for a granted scope (index, not full schema dump). */
export const TOOL_INDEX_BY_SCOPE: Partial<Record<string, readonly string[]>> = {
  'whatsapp.contact_send': ['whatsapp_send_message', 'whatsapp_send_document', 'whatsapp_send_poll'],
  'whatsapp.auto_reply': ['whatsapp_set_auto_reply'],
  'whatsapp.send': ['whatsapp_send'],
  'email.send': ['email_send'],
  'email.read': ['email_read'],
  'slack.send': ['slack_send'],
  'slack.read': ['slack_read'],
  'crm.read': ['crm_read'],
  'crm.write': ['crm_write'],
  'files.create': ['create_xlsx', 'create_report_pdf'],
  'web.research': ['research_web_search', 'research_read_url'],
  'web.read': ['browser'],
  'notion.read': ['notion_read'],
  'notion.write': ['notion_write'],
};

export function isStageKind(value: unknown): value is StageKind {
  return typeof value === 'string' && (STAGE_KINDS as readonly string[]).includes(value);
}

export function isStageChannel(value: unknown): value is StageChannel {
  return typeof value === 'string' && (STAGE_CHANNELS as readonly string[]).includes(value);
}

export function parseStageKinds(raw: unknown): StageKind[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isStageKind))];
}

export function parseStageChannels(raw: unknown): StageChannel[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(isStageChannel))];
}

export function allKindsForContract(contract: StageContract): StageKind[] {
  return [...new Set([contract.stageKind, ...contract.alsoKinds])];
}

export function isJsonOnlyKinds(kinds: readonly StageKind[]): boolean {
  return kinds.every((kind) => kind === 'source' || kind === 'transform');
}

export function scopesForStageContract(
  contract: StageContract,
  allowed?: Set<string>,
): PermissionScope[] {
  const kinds = allKindsForContract(contract);
  const channels = contract.channels.length > 0 ? contract.channels : [];
  const out: PermissionScope[] = [];
  const seen = new Set<string>();
  const add = (scopes: readonly PermissionScope[]) => {
    for (const scope of scopes) {
      if (seen.has(scope)) continue;
      if (allowed && !allowed.has(scope)) continue;
      seen.add(scope);
      out.push(scope);
    }
  };

  for (const kind of kinds) {
    if (kind === 'source' || kind === 'transform') continue;
    if (kind === 'act') {
      for (const channel of channels) add(CHANNEL_ACT_SCOPES[channel] ?? []);
    } else if (kind === 'wait') {
      for (const channel of channels) add(CHANNEL_WAIT_SCOPES[channel] ?? []);
    } else if (kind === 'deliver') {
      for (const channel of channels) add(CHANNEL_DELIVER_SCOPES[channel] ?? []);
      if (channels.length === 0 && (!allowed || allowed.has('files.create'))) {
        add(['files.create']);
      }
    }
  }
  return out;
}

export function identityScopesForStageContract(
  contract: StageContract,
  allowed?: Set<string>,
): PermissionScope[] {
  return withDefaultAgentScopes(scopesForStageContract(contract, allowed));
}

export function extraDelegatedScopes(
  delegated: readonly string[],
  kinds: readonly StageKind[],
): PermissionScope[] {
  const jsonOnly = isJsonOnlyKinds(kinds);
  return delegated.filter((scope): scope is PermissionScope => {
    if (jsonOnly) return false;
    if (scope.startsWith('assessment.')) return true;
    if (scope.startsWith('mcp.')) return true;
    if (kinds.includes('deliver') && (scope === 'system.file_write' || scope === 'system.file_read')) {
      return true;
    }
    return false;
  });
}

export function allowedScopesForDispatch(params: {
  contract: StageContract;
  delegatedScopes: readonly string[];
  knowledgeMode: 'none' | 'reference_only' | 'required';
  requested?: string[] | null;
  hasExtractedAuthoritativeInput?: boolean;
}): PermissionScope[] {
  const kinds = allKindsForContract(params.contract);
  const granted = new Set(params.delegatedScopes);
  const brain = params.knowledgeMode === 'required' && granted.has('brain.query')
    ? (['brain.query'] as PermissionScope[])
    : [];

  if (isJsonOnlyKinds(kinds)) {
    if (params.hasExtractedAuthoritativeInput || params.knowledgeMode !== 'required') {
      return brain;
    }
    return brain;
  }

  const pack = [
    ...scopesForStageContract(params.contract),
    ...extraDelegatedScopes(params.delegatedScopes, kinds),
  ].filter((scope) => granted.has(scope));
  const unique = [...new Set(pack)];
  if (!Array.isArray(params.requested)) {
    return [...new Set([...unique, ...brain])];
  }
  const requested = new Set(params.requested);
  return [...new Set([...unique.filter((scope) => requested.has(scope)), ...brain])];
}

export function cannedDispatchTask(contract: StageContract, role: string, objective: string): string {
  const kinds = allKindsForContract(contract);
  const channelList = contract.channels.length > 0 ? contract.channels.join(', ') : 'the named channel';
  if (isJsonOnlyKinds(kinds)) {
    return (
      `Read the attached records and perform the ${role} step (${kinds.join('+')}). ` +
      `Return a compact JSON Result with the matching rows (name, full phone with country code, and other relevant columns). ` +
      `Do not message anyone, do not export files, and do not call connector tools. ` +
      `Criteria from the user objective: ${objective}`
    );
  }
  if (kinds.includes('act') && kinds.includes('deliver')) {
    return (
      `Using only the Result handbacks from earlier stages, perform ${role} on ${channelList}: ` +
      `contact the listed people, then compile replies into a file and deliver it. ` +
      `Do not re-read the original source file. User objective: ${objective}`
    );
  }
  if (kinds.includes('act')) {
    return (
      `Using only the Result handbacks from earlier stages, message the listed contacts on ${channelList}. ` +
      `Do not re-read the original source file or invent extra leads. User objective: ${objective}`
    );
  }
  if (kinds.includes('deliver')) {
    return (
      `Using only Result handbacks, create the output file and deliver it on ${channelList}. ` +
      `Do not contact new people. User objective: ${objective}`
    );
  }
  if (kinds.includes('wait')) {
    return (
      `Arm reply collection on ${channelList} for contacts already messaged. Do not send a new campaign. ` +
      `User objective: ${objective}`
    );
  }
  return `Perform the ${role} part of this objective using only Result handbacks. User objective: ${objective}`;
}

export function toolIndexLines(scopes: readonly string[]): string[] {
  const names = new Set<string>();
  for (const scope of scopes) {
    for (const name of TOOL_INDEX_BY_SCOPE[scope] ?? []) names.add(name);
  }
  return [...names];
}

/**
 * One-time inference for members created before stageKind existed.
 * Uses granted scopes first, then role tokens — not the user objective.
 */
export function inferStageContract(params: {
  role: string;
  delegatedScopes: readonly string[];
  stageOrder: number;
  memberCount: number;
}): StageContract {
  const scopes = new Set(params.delegatedScopes);
  const role = params.role.toLowerCase();
  const kinds: StageKind[] = [];

  const looksJson = /\b(read|reader|extract|extraction|filter|filtering|qualify|qualifying|processor|loader|ingest)\b/.test(
    role,
  );
  const hasAssessmentAct = [...scopes].some((s) => s.startsWith('assessment.'));
  const hasChannelAct =
    scopes.has('whatsapp.contact_send') ||
    scopes.has('email.send') ||
    scopes.has('slack.send') ||
    (scopes.has('crm.write') && !hasAssessmentAct) ||
    scopes.has('web.transaction');
  const hasAct = hasChannelAct || hasAssessmentAct;
  const hasWait = scopes.has('whatsapp.auto_reply');
  const hasDeliver =
    scopes.has('files.create') ||
    scopes.has('whatsapp.send') ||
    scopes.has('system.file_write');

  // JSON-looking roles stay source/transform even if identity still has leftover connectors.
  if (looksJson) {
    kinds.push(params.stageOrder <= 1 ? 'source' : 'transform');
    return { stageKind: kinds[0]!, alsoKinds: [], channels: [] };
  }

  if (hasAct) kinds.push('act');
  if (hasWait) kinds.push('wait');
  if (hasDeliver && !hasAct) kinds.push('deliver');

  if (kinds.length === 0) {
    kinds.push(params.stageOrder <= 1 ? 'source' : 'transform');
  }

  const [stageKind, ...alsoKinds] = kinds as [StageKind, ...StageKind[]];
  const channels = inferChannelsForKinds(scopes, [stageKind, ...alsoKinds], {
    hasAssessmentAct,
    hasChannelAct,
  });
  return { stageKind, alsoKinds, channels };
}

function inferChannelsForKinds(
  scopes: Set<string>,
  kinds: StageKind[],
  flags: { hasAssessmentAct: boolean; hasChannelAct: boolean },
): StageChannel[] {
  if (isJsonOnlyKinds(kinds)) return [];
  // Assessment-only act: scopes come from extraDelegatedScopes, not channel packs.
  if (flags.hasAssessmentAct && !flags.hasChannelAct) return [];

  const channels: StageChannel[] = [];
  const hasMessaging =
    [...scopes].some((s) => s.startsWith('whatsapp.')) ||
    [...scopes].some((s) => s.startsWith('email.')) ||
    [...scopes].some((s) => s.startsWith('slack.'));

  if ([...scopes].some((s) => s.startsWith('whatsapp.'))) channels.push('whatsapp');
  if ([...scopes].some((s) => s.startsWith('email.'))) channels.push('email');
  if ([...scopes].some((s) => s.startsWith('slack.'))) channels.push('slack');
  if (!hasMessaging && [...scopes].some((s) => s.startsWith('crm.'))) channels.push('crm');
  if (!hasMessaging && [...scopes].some((s) => s.startsWith('notion.'))) channels.push('notion');
  if (!hasMessaging && [...scopes].some((s) => s.startsWith('web.'))) channels.push('web');
  if (
    kinds.includes('deliver') &&
    (scopes.has('files.create') || scopes.has('system.file_write')) &&
    !channels.includes('files')
  ) {
    channels.push('files');
  }
  return channels;
}

export function contractFromMember(member: {
  role: string;
  delegatedScopes: readonly string[];
  stageOrder: number;
  stageKind?: string | null;
  alsoKinds?: string[] | null;
  channels?: string[] | null;
}, memberCount: number): StageContract {
  if (isStageKind(member.stageKind)) {
    return {
      stageKind: member.stageKind,
      alsoKinds: parseStageKinds(member.alsoKinds),
      channels: parseStageChannels(member.channels),
    };
  }
  return inferStageContract({
    role: member.role,
    delegatedScopes: member.delegatedScopes,
    stageOrder: member.stageOrder,
    memberCount,
  });
}

function inferWorkerContractFromPlanner(worker: NLWorkerSpec, index: number, total: number): StageContract {
  if (isStageKind(worker.stageKind)) {
    return {
      stageKind: worker.stageKind,
      alsoKinds: worker.alsoKinds ?? [],
      channels: worker.channels ?? [],
    };
  }
  return inferStageContract({
    role: worker.role,
    delegatedScopes: worker.permissionScopes,
    stageOrder: worker.stageOrder || index + 1,
    memberCount: total,
  });
}

/**
 * Overwrite worker (and coordinator) scopes from stage kinds so whole-prompt
 * enrichment cannot leak WhatsApp/file tools onto a reader.
 */
export function applyStageKindPacksToPlan(
  plan: AgentCreationPlan,
  allowed: Set<string>,
): AgentCreationPlan {
  if (plan.type !== 'team') return plan;
  const workers = plan.team.workers.map((worker, index) => {
    const contract = inferWorkerContractFromPlanner(worker, index, plan.team.workers.length);
    const pack = identityScopesForStageContract(contract, allowed);
    const permissionScopes = isJsonOnlyKinds(allKindsForContract(contract))
      ? pack
      : withDefaultAgentScopes([
          ...pack,
          ...worker.permissionScopes.filter((scope) => scope.startsWith('mcp.') && allowed.has(scope)),
        ]);
    const jitKeep = new Set(permissionScopes);
    return {
      ...worker,
      stageKind: contract.stageKind,
      alsoKinds: contract.alsoKinds,
      channels: contract.channels,
      permissionScopes,
      jitScopes: worker.jitScopes.filter((scope) => jitKeep.has(scope)),
    };
  });

  const supervisorScopes = withDefaultAgentScopes([]);

  return {
    ...plan,
    team: {
      ...plan.team,
      workers,
      supervisor: {
        ...plan.team.supervisor,
        permissionScopes: supervisorScopes,
        jitScopes: plan.team.supervisor.jitScopes.filter((s) => supervisorScopes.includes(s)),
      },
    },
  };
}
