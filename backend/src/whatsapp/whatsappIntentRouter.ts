import { prisma } from '../lib/prisma.js';
import { openRouterChatCompletion } from '../llm/openrouterClient.js';
import { getRoleManifest } from '../employees/rolePacks.js';
import type { ConnectorAccountDTO } from '../connectors/connectors.types.js';

const CLASSIFIER_MODEL = 'openrouter/openai/gpt-4o-mini';
const HEARTBEAT_FRESH_MS = 20_000;
const DESCRIPTION_PREVIEW = 300;

const PC_TASK_PATTERN =
  /[A-Za-z]:\\|[A-Za-z]:\/|\bon my pc\b|\bon my computer\b|\blocal file\b|\bopen in notepad\b|\bopen on my screen\b/i;

export type IntentRosterAgent = {
  id: string;
  name: string;
  description: string;
  permissionScopes: string[];
  runtime: string;
  online: boolean;
  roleMission: string | null;
};

export type IntentRosterTeam = {
  id: string;
  name: string;
  description: string;
  memberSummary: string;
};

export type IntentRouteDecision = {
  targetType: 'agent' | 'team';
  targetId: string;
  targetName: string;
  confidence: number;
  reason: string;
  source: 'heuristic' | 'llm' | 'default' | 'single';
};

export type DisambiguationOption = {
  targetType: 'agent' | 'team';
  targetId: string;
  name: string;
  label: string;
};

function agentScopeWhere(connector: ConnectorAccountDTO) {
  return { OR: [{ orgId: connector.orgId }, { userId: connector.userId, orgId: null }] };
}

function isHeartbeatFresh(at: Date | null | undefined): boolean {
  if (!at) return false;
  return Date.now() - at.getTime() < HEARTBEAT_FRESH_MS;
}

function agentOnline(row: {
  runtime: string;
  hybridLastHeartbeatAt: Date | null;
  cloudLastHeartbeatAt: Date | null;
}): boolean {
  if (row.runtime === 'hybrid') return isHeartbeatFresh(row.hybridLastHeartbeatAt);
  if (row.runtime === 'cloud') return isHeartbeatFresh(row.cloudLastHeartbeatAt);
  return false;
}

function truncateDescription(text: string | null | undefined): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  return t.length > DESCRIPTION_PREVIEW ? `${t.slice(0, DESCRIPTION_PREVIEW)}…` : t;
}

export async function buildWhatsAppIntentRoster(connector: ConnectorAccountDTO): Promise<{
  agents: IntentRosterAgent[];
  teams: IntentRosterTeam[];
}> {
  const agentRows = await prisma.agent.findMany({
    where: {
      ...agentScopeWhere(connector),
      agentKind: { not: 'org_brain' },
    },
    select: {
      id: true,
      name: true,
      description: true,
      permissionScopes: true,
      runtime: true,
      hybridLastHeartbeatAt: true,
      cloudLastHeartbeatAt: true,
      employeeEngagement: { select: { roleSlug: true } },
    },
    orderBy: { name: 'asc' },
  });

  const agents: IntentRosterAgent[] = agentRows.map((a) => {
    const slug = a.employeeEngagement?.roleSlug;
    const mission = slug ? getRoleManifest(slug)?.mission ?? null : null;
    return {
      id: a.id,
      name: a.name,
      description: truncateDescription(a.description),
      permissionScopes: a.permissionScopes,
      runtime: a.runtime,
      online: agentOnline(a),
      roleMission: mission,
    };
  });

  const teamRows = await prisma.team.findMany({
    where: { orgId: connector.orgId, status: { not: 'archived' } },
    select: {
      id: true,
      name: true,
      description: true,
      members: {
        select: {
          role: true,
          agent: { select: { name: true, description: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const teams: IntentRosterTeam[] = teamRows.map((t) => {
    const memberSummary = t.members
      .map((m) => {
        const desc = truncateDescription(m.agent.description);
        const descPart = desc ? ` — ${desc.slice(0, 80)}` : '';
        return `${m.agent.name} (${m.role})${descPart}`;
      })
      .join('; ');
    return {
      id: t.id,
      name: t.name,
      description: truncateDescription(t.description),
      memberSummary,
    };
  });

  return { agents, teams };
}

function formatAgentLine(a: IntentRosterAgent, index: number): string {
  const parts = [
    `${index + 1}. Agent "${a.name}" id=${a.id}`,
    `runtime=${a.runtime}`,
    a.online ? 'online' : 'offline',
    `scopes=${a.permissionScopes.join(', ') || 'none'}`,
  ];
  if (a.roleMission) parts.push(`role=${a.roleMission.slice(0, 120)}`);
  if (a.description) parts.push(`desc=${a.description}`);
  return parts.join(' | ');
}

function formatTeamLine(t: IntentRosterTeam, index: number): string {
  const parts = [
    `${index + 1}. Team "${t.name}" id=${t.id}`,
  ];
  if (t.description) parts.push(`desc=${t.description}`);
  if (t.memberSummary) parts.push(`members=${t.memberSummary.slice(0, 200)}`);
  return parts.join(' | ');
}

export function applyHeuristicRoute(
  prompt: string,
  agents: IntentRosterAgent[],
  defaultAgentId: string | null,
): IntentRouteDecision | null {
  if (agents.length === 1) {
    const a = agents[0]!;
    return {
      targetType: 'agent',
      targetId: a.id,
      targetName: a.name,
      confidence: 1,
      reason: 'only agent in workspace',
      source: 'single',
    };
  }

  if (defaultAgentId && prompt.trim().length < 20) {
    const def = agents.find((a) => a.id === defaultAgentId);
    if (def) {
      return {
        targetType: 'agent',
        targetId: def.id,
        targetName: def.name,
        confidence: 0.8,
        reason: 'short message with default agent',
        source: 'default',
      };
    }
  }

  if (PC_TASK_PATTERN.test(prompt)) {
    const hybridOnline = agents.filter(
      (a) => a.runtime === 'hybrid' && a.online && a.permissionScopes.includes('system.file_read'),
    );
    if (hybridOnline.length === 1) {
      const a = hybridOnline[0]!;
      return {
        targetType: 'agent',
        targetId: a.id,
        targetName: a.name,
        confidence: 0.9,
        reason: 'local PC / file task',
        source: 'heuristic',
      };
    }
    const hybridAny = agents.filter(
      (a) => a.runtime === 'hybrid' && a.permissionScopes.includes('system.file_read'),
    );
    if (hybridAny.length === 1) {
      const a = hybridAny[0]!;
      return {
        targetType: 'agent',
        targetId: a.id,
        targetName: a.name,
        confidence: 0.75,
        reason: 'local file task (hybrid agent)',
        source: 'heuristic',
      };
    }
  }

  return null;
}

const ROUTE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'route_whatsapp_message',
    description: 'Pick the best agent or team for an inbound WhatsApp message.',
    parameters: {
      type: 'object',
      properties: {
        targetType: { type: 'string', enum: ['agent', 'team'] },
        targetId: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reason: { type: 'string', maxLength: 120 },
      },
      required: ['targetType', 'targetId', 'confidence', 'reason'],
    },
  },
};

async function llmRoute(
  prompt: string,
  agents: IntentRosterAgent[],
  teams: IntentRosterTeam[],
): Promise<IntentRouteDecision | null> {
  if (agents.length === 0 && teams.length === 0) return null;

  const agentLines = agents.map((a, i) => formatAgentLine(a, i)).join('\n');
  const teamLines = teams.map((t, i) => formatTeamLine(t, i)).join('\n');

  const system = `You route inbound WhatsApp messages to the best Qlix agent or team.

Rules:
- Pick ONE agent for single-step tasks; pick a team only when the goal clearly needs multiple specialists working in sequence.
- Prefer online hybrid agents for local PC / file / "open Notepad" requests.
- Match agent descriptions, role missions, and permission scopes to the user's request.
- targetId MUST be copied exactly from the roster — never invent IDs.
- If nothing fits well, pick the closest agent with confidence below 0.45.

Agents:
${agentLines || '(none)'}

Teams:
${teamLines || '(none)'}`;

  try {
    const result = await openRouterChatCompletion(
      {
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt.slice(0, 2000) },
        ],
        temperature: 0.1,
        max_tokens: 128,
        stream: false,
        tools: [ROUTE_TOOL],
        tool_choice: { type: 'function', function: { name: 'route_whatsapp_message' } },
      },
      { timeoutMs: 15_000, retries: 1 },
    );

    const call = result.toolCalls?.[0];
    if (!call || call.function.name !== 'route_whatsapp_message') return null;

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      return null;
    }

    const targetType = args.targetType === 'team' ? 'team' : 'agent';
    const targetId = String(args.targetId ?? '').trim();
    const confidence = Math.min(1, Math.max(0, Number(args.confidence) || 0));
    const reason = String(args.reason ?? '').slice(0, 120);

    if (!targetId) return null;

    if (targetType === 'agent') {
      const agent = agents.find((a) => a.id === targetId);
      if (!agent) return null;
      return {
        targetType: 'agent',
        targetId: agent.id,
        targetName: agent.name,
        confidence,
        reason,
        source: 'llm',
      };
    }

    const team = teams.find((t) => t.id === targetId);
    if (!team) return null;
    return {
      targetType: 'team',
      targetId: team.id,
      targetName: team.name,
      confidence,
      reason,
      source: 'llm',
    };
  } catch (err) {
    console.warn('[whatsapp-intent] LLM routing failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function classifyWhatsAppIntent(
  connector: ConnectorAccountDTO,
  prompt: string,
): Promise<IntentRouteDecision | null> {
  const { agents, teams } = await buildWhatsAppIntentRoster(connector);

  const heuristic = applyHeuristicRoute(prompt, agents, connector.whatsappDefaultAgentId);
  if (heuristic) {
    console.log(
      `[whatsapp-intent] heuristic connector=${connector.id} agent=${heuristic.targetName} confidence=${heuristic.confidence}`,
    );
    return heuristic;
  }

  const llm = await llmRoute(prompt, agents, teams);
  if (llm) {
    console.log(
      `[whatsapp-intent] llm connector=${connector.id} ${llm.targetType}=${llm.targetName} confidence=${llm.confidence} reason=${llm.reason}`,
    );
    return llm;
  }

  return null;
}

export function routeHintForConfidence(decision: IntentRouteDecision): string | null {
  if (decision.confidence >= 0.75) return null;
  if (decision.confidence >= 0.45 && decision.reason) return decision.reason;
  return null;
}

export function buildDisambiguationOptions(agents: IntentRosterAgent[]): DisambiguationOption[] {
  return agents.map((a) => {
    const status = a.online ? 'online' : 'offline';
    const desc = a.description || a.roleMission;
    const label = desc
      ? `${a.name} (${a.runtime}, ${status}) — ${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}`
      : `${a.name} (${a.runtime}, ${status})`;
    return {
      targetType: 'agent' as const,
      targetId: a.id,
      name: a.name,
      label,
    };
  });
}

export function formatDisambiguationMenu(options: DisambiguationOption[]): string {
  const lines = ['I can help — which agent should handle this?', ''];
  options.forEach((o, i) => {
    lines.push(`${i + 1}. ${o.label}`);
  });
  lines.push('', 'Reply 1–' + options.length + ', or set a WhatsApp default agent in Connectors.');
  return lines.join('\n');
}

export function parseDisambiguationSelection(text: string, optionCount: number): number | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  if (n < 1 || n > optionCount) return null;
  return n - 1;
}
