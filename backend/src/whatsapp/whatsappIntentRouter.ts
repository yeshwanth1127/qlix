import { prisma } from '../lib/prisma.js';
import {
  chatCompletion,
  defaultLlmProvider,
  defaultModelForProvider,
  LLM_APPLICATION_IDS,
} from '../llm/inferenceRouter.js';
import { getRoleManifest } from '../employees/rolePacks.js';
import type { ConnectorAccountDTO } from '../connectors/connectors.types.js';

const CLASSIFIER_PROVIDER = defaultLlmProvider();
const CLASSIFIER_MODEL = defaultModelForProvider(CLASSIFIER_PROVIDER);
const HEARTBEAT_FRESH_MS = 20_000;
const DESCRIPTION_PREVIEW = 120;
const LLM_DESC_CHARS = 80;
const LLM_PROMPT_CHARS = 500;
const LLM_TOP_K = 3;
const SCORE_WIN_THRESHOLD = 3;
const SCORE_MARGIN_THRESHOLD = 2;
const SCORE_SIGNAL_FLOOR = 1.5;
const DEFAULT_AGENT_PRIOR = 0.5;

const PC_TASK_PATTERN =
  /[A-Za-z]:\\|[A-Za-z]:\/|\bon my pc\b|\bon my computer\b|\blocal file\b|\bopen in notepad\b|\bopen on my screen\b|\bread .{0,40}\.log\b/i;

const CAPABILITY_RULES: Array<{ pattern: RegExp; scopePrefixes: string[]; weight: number }> = [
  {
    pattern: /\b(email|inbox|gmail|outlook|mail)\b/i,
    scopePrefixes: ['email.'],
    weight: 3,
  },
  {
    pattern: /\b(web|search|research|browse|google|scrap)\b/i,
    scopePrefixes: ['web.'],
    weight: 3,
  },
  {
    pattern: /\b(brain|policy|playbook|knowledge|handbook)\b/i,
    scopePrefixes: ['brain.'],
    weight: 2.5,
  },
  {
    pattern: /\b(file|folder|directory|notepad|desktop|screenshot|gui)\b/i,
    scopePrefixes: ['system.file', 'system.gui'],
    weight: 2.5,
  },
];

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'for',
  'of',
  'in',
  'on',
  'my',
  'me',
  'i',
  'is',
  'it',
  'this',
  'that',
  'with',
  'from',
  'please',
  'can',
  'you',
  'your',
  'our',
  'we',
  'be',
  'do',
  'at',
  'as',
  'by',
]);

export type IntentRosterAgent = {
  id: string;
  name: string;
  description: string;
  permissionScopes: string[];
  runtime: string;
  online: boolean;
  roleMission: string | null;
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

export type AgentScore = {
  agent: IntentRosterAgent;
  score: number;
  reasons: string[];
};

export type ClassifyWhatsAppIntentResult = {
  decision: IntentRouteDecision | null;
  agents: IntentRosterAgent[];
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

function truncateText(text: string | null | undefined, max: number): string {
  const t = (text ?? '').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function hasScopePrefix(scopes: string[], prefixes: string[]): boolean {
  return scopes.some((s) => prefixes.some((p) => s === p || s.startsWith(p)));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameMentioned(prompt: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false;
  const re = new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i');
  return re.test(prompt);
}

function promptTokens(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
    .slice(0, 24);
}

function tokenOverlapScore(promptToks: string[], text: string | null | undefined): number {
  if (!text || promptToks.length === 0) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const t of promptToks) {
    if (hay.includes(t)) hits += 1;
  }
  if (hits === 0) return 0;
  return Math.min(2, hits * 0.4);
}

function capsTag(scopes: string[]): string {
  const tags: string[] = [];
  if (scopes.some((s) => s.startsWith('email.'))) tags.push('email');
  if (scopes.some((s) => s.startsWith('web.'))) tags.push('web');
  if (scopes.some((s) => s.startsWith('brain.'))) tags.push('brain');
  if (scopes.some((s) => s.startsWith('system.file'))) tags.push('files');
  if (scopes.some((s) => s.startsWith('system.gui'))) tags.push('gui');
  return tags.join(',') || 'none';
}

export async function buildWhatsAppIntentRoster(connector: ConnectorAccountDTO): Promise<{
  agents: IntentRosterAgent[];
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
      description: truncateText(a.description, DESCRIPTION_PREVIEW),
      permissionScopes: a.permissionScopes,
      runtime: a.runtime,
      online: agentOnline(a),
      roleMission: mission,
    };
  });

  return { agents };
}

export function scoreAgents(
  prompt: string,
  agents: IntentRosterAgent[],
  defaultAgentId: string | null,
): AgentScore[] {
  const toks = promptTokens(prompt);
  const isPcTask = PC_TASK_PATTERN.test(prompt);

  return agents
    .map((agent) => {
      let score = 0;
      const reasons: string[] = [];

      if (nameMentioned(prompt, agent.name)) {
        score += 8;
        reasons.push('name mention');
      }

      if (defaultAgentId && agent.id === defaultAgentId) {
        score += DEFAULT_AGENT_PRIOR;
        reasons.push('default prior');
      }

      if (isPcTask && agent.runtime === 'hybrid' && agent.permissionScopes.includes('system.file_read')) {
        score += 5;
        reasons.push('local PC / file task');
        if (agent.online) {
          score += 1.5;
          reasons.push('online');
        }
      }

      for (const rule of CAPABILITY_RULES) {
        if (rule.pattern.test(prompt) && hasScopePrefix(agent.permissionScopes, rule.scopePrefixes)) {
          score += rule.weight;
          reasons.push(`caps:${rule.scopePrefixes[0]}`);
        }
      }

      const overlap =
        tokenOverlapScore(toks, agent.description) + tokenOverlapScore(toks, agent.roleMission);
      if (overlap > 0) {
        score += overlap;
        reasons.push('desc overlap');
      }

      return { agent, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

function decisionForAgent(
  agent: IntentRosterAgent,
  confidence: number,
  reason: string,
  source: IntentRouteDecision['source'],
): IntentRouteDecision {
  return {
    targetType: 'agent',
    targetId: agent.id,
    targetName: agent.name,
    confidence,
    reason,
    source,
  };
}

/**
 * Cheap local routing. Returns a decision when confident enough to skip the LLM,
 * otherwise null (caller may invoke slim LLM on top-K scores).
 */
export function applyHeuristicRoute(
  prompt: string,
  agents: IntentRosterAgent[],
  defaultAgentId: string | null,
): IntentRouteDecision | null {
  if (agents.length === 0) return null;

  if (agents.length === 1) {
    return decisionForAgent(agents[0]!, 1, 'only agent in workspace', 'single');
  }

  const scores = scoreAgents(prompt, agents, defaultAgentId);
  const nameHits = agents.filter((a) => nameMentioned(prompt, a.name));
  if (nameHits.length === 1) {
    return decisionForAgent(nameHits[0]!, 0.95, 'agent name mentioned', 'heuristic');
  }

  const top = scores[0];
  const second = scores[1];
  if (!top) return null;

  const margin = top.score - (second?.score ?? 0);
  const signalScore = top.score - (defaultAgentId && top.agent.id === defaultAgentId ? DEFAULT_AGENT_PRIOR : 0);

  if (top.score >= SCORE_WIN_THRESHOLD && margin >= SCORE_MARGIN_THRESHOLD) {
    const reason = top.reasons.filter((r) => r !== 'default prior').join(', ') || 'local score';
    const confidence = Math.min(0.92, 0.7 + margin * 0.04);
    return decisionForAgent(top.agent, confidence, reason, 'heuristic');
  }

  // No meaningful signal → default without LLM.
  if (signalScore < SCORE_SIGNAL_FLOOR && defaultAgentId) {
    const def = agents.find((a) => a.id === defaultAgentId);
    if (def) {
      return decisionForAgent(def, 0.8, 'default agent (no strong signal)', 'default');
    }
  }

  return null;
}

export function topKAgentsForLlm(
  prompt: string,
  agents: IntentRosterAgent[],
  defaultAgentId: string | null,
  k = LLM_TOP_K,
): IntentRosterAgent[] {
  if (agents.length <= k) return agents;
  return scoreAgents(prompt, agents, defaultAgentId)
    .slice(0, k)
    .map((s) => s.agent);
}

function formatAgentLine(a: IntentRosterAgent, index: number): string {
  const parts = [
    `${index + 1}. "${a.name}" id=${a.id}`,
    a.runtime,
    a.online ? 'on' : 'off',
    `caps=${capsTag(a.permissionScopes)}`,
  ];
  const role = truncateText(a.roleMission, LLM_DESC_CHARS);
  const desc = truncateText(a.description, LLM_DESC_CHARS);
  if (role) parts.push(`role=${role}`);
  if (desc) parts.push(`desc=${desc}`);
  return parts.join(' | ');
}

const ROUTE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'route_whatsapp_message',
    description: 'Pick the best agent for an inbound WhatsApp message.',
    parameters: {
      type: 'object',
      properties: {
        targetType: { type: 'string', enum: ['agent'] },
        targetId: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reason: { type: 'string', maxLength: 80 },
      },
      required: ['targetType', 'targetId', 'confidence', 'reason'],
    },
  },
};

async function llmRoute(
  prompt: string,
  agents: IntentRosterAgent[],
): Promise<IntentRouteDecision | null> {
  if (agents.length === 0) return null;

  const agentLines = agents.map((a, i) => formatAgentLine(a, i)).join('\n');

  const system = `Route this WhatsApp message to ONE agent from the list.
Prefer online hybrid agents for local PC/file tasks. Match caps/desc to the request.
Copy targetId exactly. If unsure, confidence < 0.45.

Agents:
${agentLines}`;

  try {
    const result = await chatCompletion(
      {
        model: CLASSIFIER_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt.slice(0, LLM_PROMPT_CHARS) },
        ],
        temperature: 0.1,
        max_tokens: 64,
        stream: false,
        tools: [ROUTE_TOOL],
        tool_choice: { type: 'function', function: { name: 'route_whatsapp_message' } },
      },
      {
        provider: CLASSIFIER_PROVIDER,
        applicationId: LLM_APPLICATION_IDS.whatsappRouter,
        timeoutMs: 15_000,
        retries: 1,
      },
    );

    const call = result.toolCalls?.[0];
    if (!call || call.function.name !== 'route_whatsapp_message') return null;

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments) as Record<string, unknown>;
    } catch {
      return null;
    }

    const targetId = String(args.targetId ?? '').trim();
    const confidence = Math.min(1, Math.max(0, Number(args.confidence) || 0));
    const reason = String(args.reason ?? '').slice(0, 80);

    if (!targetId) return null;

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
  } catch (err) {
    console.warn('[whatsapp-intent] LLM routing failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function classifyWhatsAppIntent(
  connector: ConnectorAccountDTO,
  prompt: string,
): Promise<ClassifyWhatsAppIntentResult> {
  const { agents } = await buildWhatsAppIntentRoster(connector);

  const heuristic = applyHeuristicRoute(prompt, agents, connector.whatsappDefaultAgentId);
  if (heuristic) {
    console.log(
      `[whatsapp-intent] ${heuristic.source} connector=${connector.id} agent=${heuristic.targetName} confidence=${heuristic.confidence}`,
    );
    return { decision: heuristic, agents };
  }

  const candidates = topKAgentsForLlm(prompt, agents, connector.whatsappDefaultAgentId);
  const llm = await llmRoute(prompt, candidates);
  if (llm) {
    console.log(
      `[whatsapp-intent] llm connector=${connector.id} agent=${llm.targetName} confidence=${llm.confidence} reason=${llm.reason}`,
    );
    return { decision: llm, agents };
  }

  return { decision: null, agents };
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
