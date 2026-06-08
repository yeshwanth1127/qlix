import { openRouterChatCompletion } from '../llm/openrouterClient.js';
import { ALL_PERMISSION_SCOPES, type PermissionScope } from './agents.types.js';
import { FORCE_JIT_SCOPES } from './jit.js';
import { buildAgentToolSchema, buildTeamToolSchema, buildSystemPrompt } from './nlCapabilities.js';
import type { AgentCreationPlan, NLAgentSpec, NLWorkerSpec } from './nlTypes.js';

const DEFAULT_NL_PARSE_MODEL = 'openrouter/anthropic/claude-3.5-sonnet';

function isValidPermissionScope(s: unknown): s is PermissionScope {
  return ALL_PERMISSION_SCOPES.includes(s as PermissionScope);
}

function sanitizeScopes(raw: unknown): PermissionScope[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidPermissionScope);
}

function sanitizeAgentSpec(rawInput: unknown, fallbackName: string): NLAgentSpec {
  // The model can emit null / non-object entries; coerce so we never deref null.
  const raw: Record<string, unknown> =
    rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  const permissionScopes = sanitizeScopes(raw.permissionScopes);
  const rawJit = sanitizeScopes(raw.jitScopes);
  const scopeSet = new Set(permissionScopes);
  const jitScopes = [
    ...new Set([
      ...rawJit.filter((s) => scopeSet.has(s)),
      ...(FORCE_JIT_SCOPES as PermissionScope[]).filter((s) => scopeSet.has(s)),
    ]),
  ];

  const runtime = ['cloud', 'hybrid', 'local'].includes(raw.runtime as string)
    ? (raw.runtime as 'cloud' | 'hybrid' | 'local')
    : 'cloud';

  let llmMode: 'proxy' | 'direct' = 'proxy';
  let localInferenceMode: 'local_llm' | 'cloud_api' | null = null;

  if (runtime === 'cloud' || runtime === 'hybrid') {
    llmMode = 'proxy';
    localInferenceMode = null;
  } else {
    llmMode = raw.llmMode === 'direct' ? 'direct' : 'proxy';
    localInferenceMode =
      raw.localInferenceMode === 'local_llm' ? 'local_llm'
      : raw.localInferenceMode === 'cloud_api' ? 'cloud_api'
      : 'cloud_api';
  }

  return {
    name: String(raw.name ?? fallbackName).slice(0, 120),
    description: String(raw.description ?? '').slice(0, 10000),
    permissionScopes,
    jitScopes,
    runtime,
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULT_NL_PARSE_MODEL,
    llmMode,
    localInferenceMode,
    rationale: String(raw.rationale ?? ''),
  };
}

function sanitizeWorkerSpec(rawInput: unknown, index: number): NLWorkerSpec {
  const raw: Record<string, unknown> =
    rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  const base = sanitizeAgentSpec(raw, `Worker ${index + 1}`);
  return {
    ...base,
    role: String(raw.role ?? 'worker').slice(0, 80),
    stageOrder: typeof raw.stageOrder === 'number' && raw.stageOrder > 0 ? Math.floor(raw.stageOrder) : index + 1,
  };
}

export class NLParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NLParseError';
  }
}

export async function parseAgentCreationPrompt(userPrompt: string, model?: string): Promise<AgentCreationPlan> {
  const resolvedModel = model?.trim() || DEFAULT_NL_PARSE_MODEL;

  const result = await openRouterChatCompletion(
    {
      model: resolvedModel,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: userPrompt.slice(0, 5000) },
      ],
      temperature: 0.1,
      max_tokens: 2048,
      stream: false,
      tools: [buildAgentToolSchema(), buildTeamToolSchema()],
      tool_choice: 'required',
    },
    { timeoutMs: 45_000, retries: 1 },
  );

  if (!result.toolCalls?.length) {
    throw new NLParseError('Model did not call a planning tool');
  }

  const toolCall = result.toolCalls[0];

  let args: unknown;
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new NLParseError('Tool call arguments were not valid JSON');
  }

  if (typeof args !== 'object' || args === null) {
    throw new NLParseError('Tool call arguments had unexpected type');
  }

  const obj = args as Record<string, unknown>;

  if (toolCall.function.name === 'plan_single_agent') {
    const agentRaw = obj.agent as Record<string, unknown> | undefined;
    if (!agentRaw || typeof agentRaw !== 'object') {
      throw new NLParseError('plan_single_agent: missing agent field');
    }
    return {
      type: 'single',
      agent: sanitizeAgentSpec(agentRaw, 'My Agent'),
      rationale: String(obj.rationale ?? ''),
    };
  }

  if (toolCall.function.name === 'plan_team') {
    const teamRaw = obj.team as Record<string, unknown> | undefined;
    if (!teamRaw || typeof teamRaw !== 'object') {
      throw new NLParseError('plan_team: missing team field');
    }

    const supervisorRaw = teamRaw.supervisor as Record<string, unknown> | undefined;
    if (!supervisorRaw || typeof supervisorRaw !== 'object') {
      throw new NLParseError('plan_team: missing supervisor');
    }

    const workersRaw = (Array.isArray(teamRaw.workers) ? teamRaw.workers : []).filter(
      (w) => w && typeof w === 'object',
    );
    const configRaw = (teamRaw.config ?? {}) as Record<string, unknown>;

    return {
      type: 'team',
      rationale: String(obj.rationale ?? ''),
      team: {
        name: String(teamRaw.name ?? 'My Team').slice(0, 120),
        description: String(teamRaw.description ?? '').slice(0, 10000),
        supervisor: sanitizeAgentSpec(supervisorRaw, 'Supervisor'),
        workers: workersRaw.map((w, i) => sanitizeWorkerSpec(w as Record<string, unknown>, i)),
        config: {
          maxParallelWorkers: typeof configRaw.maxParallelWorkers === 'number' ? configRaw.maxParallelWorkers : 3,
          subtaskTimeoutMs: typeof configRaw.subtaskTimeoutMs === 'number' ? configRaw.subtaskTimeoutMs : 180_000,
          retryPolicy: ['none', 'once', 'twice'].includes(configRaw.retryPolicy as string)
            ? (configRaw.retryPolicy as 'none' | 'once' | 'twice')
            : 'once',
        },
      },
    };
  }

  throw new NLParseError(`Unexpected tool name: ${toolCall.function.name}`);
}
