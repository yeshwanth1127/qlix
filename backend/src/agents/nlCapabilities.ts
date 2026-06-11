import type { ScopeDef } from './scopeCatalog.js';

const AGENT_REQUIRED = [
  'name',
  'description',
  'permissionScopes',
  'jitScopes',
  'runtime',
  'model',
  'llmMode',
  'localInferenceMode',
  'rationale',
];

/** Agent property schema, with scope enums narrowed to the scopes available this request. */
function agentPropertiesSchema(scopeIds: string[]): Record<string, unknown> {
  return {
    name: { type: 'string', description: 'Short descriptive name, e.g. "Web Researcher"', maxLength: 120 },
    description: {
      type: 'string',
      description: 'Task-specific system prompt for the agent. Be precise about what it does.',
      maxLength: 10000,
    },
    permissionScopes: {
      type: 'array',
      description: 'Minimum set of permission scopes required. JIT-forced scopes must also appear in jitScopes.',
      items: { type: 'string', enum: scopeIds },
    },
    jitScopes: {
      type: 'array',
      description: 'Subset of permissionScopes requiring user approval on every invocation. Must include all JIT-forced scopes present in permissionScopes.',
      items: { type: 'string', enum: scopeIds },
    },
    runtime: {
      type: 'string',
      enum: ['cloud', 'hybrid', 'local'],
      description: 'cloud = Qlix servers (default); hybrid = Qlix-hosted + local tool execution; local = SDK on user machine.',
    },
    model: { type: 'string', description: 'LLM model ID, e.g. "openrouter/anthropic/claude-sonnet-4.6"' },
    llmMode: {
      type: 'string',
      enum: ['proxy', 'direct'],
      description: 'proxy for cloud/hybrid; direct or proxy for local.',
    },
    localInferenceMode: {
      anyOf: [{ type: 'string', enum: ['local_llm', 'cloud_api'] }, { type: 'null' }],
      description: 'null for cloud/hybrid; "local_llm" or "cloud_api" for local runtime.',
    },
    rationale: { type: 'string', description: 'Brief explanation of why these choices were made.' },
  };
}

export function buildAgentToolSchema(scopes: ScopeDef[]): Record<string, unknown> {
  const scopeIds = scopes.map((s) => s.id);
  return {
    type: 'function',
    function: {
      name: 'plan_single_agent',
      description: "Plan a single Qlix agent. Call this when the user describes ONE agent's purpose.",
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string', description: 'Why these permissions and runtime were chosen.' },
          agent: {
            type: 'object',
            properties: agentPropertiesSchema(scopeIds),
            required: AGENT_REQUIRED,
            additionalProperties: false,
          },
        },
        required: ['rationale', 'agent'],
        additionalProperties: false,
      },
    },
  };
}

export function buildTeamToolSchema(scopes: ScopeDef[]): Record<string, unknown> {
  const scopeIds = scopes.map((s) => s.id);
  const props = agentPropertiesSchema(scopeIds);
  return {
    type: 'function',
    function: {
      name: 'plan_team',
      description: 'Plan a supervisor + workers team. Call when the user describes multiple coordinating agents, a pipeline, or a team.',
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string', description: 'Why a team structure was chosen.' },
          team: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 120, description: 'Team name.' },
              description: { type: 'string', maxLength: 10000, description: 'Team purpose.' },
              supervisor: {
                type: 'object',
                description: 'Orchestrator agent that delegates to workers and synthesizes results.',
                properties: props,
                required: AGENT_REQUIRED,
                additionalProperties: false,
              },
              workers: {
                type: 'array',
                description: 'Specialized worker agents.',
                items: {
                  type: 'object',
                  properties: {
                    ...props,
                    role: {
                      type: 'string',
                      maxLength: 80,
                      description: 'Worker role, e.g. researcher, writer, analyst.',
                    },
                    stageOrder: {
                      type: 'integer',
                      minimum: 1,
                      description: 'Execution order starting at 1.',
                    },
                  },
                  required: [...AGENT_REQUIRED, 'role', 'stageOrder'],
                  additionalProperties: false,
                },
              },
              config: {
                type: 'object',
                properties: {
                  maxParallelWorkers: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
                  subtaskTimeoutMs: { type: 'integer', minimum: 30000, default: 180000 },
                  retryPolicy: { type: 'string', enum: ['none', 'once', 'twice'], default: 'once' },
                },
                required: ['maxParallelWorkers', 'subtaskTimeoutMs', 'retryPolicy'],
                additionalProperties: false,
              },
            },
            required: ['name', 'description', 'supervisor', 'workers', 'config'],
            additionalProperties: false,
          },
        },
        required: ['rationale', 'team'],
        additionalProperties: false,
      },
    },
  };
}

export function buildSystemPrompt(scopes: ScopeDef[]): string {
  const scopeList = scopes
    .map((s) => `  ${s.id} — ${s.description}${s.forceJit ? ' [JIT-forced]' : ''}`)
    .join('\n');
  const forceJitList = scopes
    .filter((s) => s.forceJit)
    .map((s) => s.id)
    .join(', ');

  return `You are an agent configuration expert for the Qlix AI agent platform.
Call EXACTLY ONE of the provided tools — plan_single_agent or plan_team — based on the user description.

## Which tool to call
- plan_single_agent: user describes a single agent's purpose.
- plan_team: user describes multiple coordinating agents, a pipeline, supervisor/workers, or a team.

## Available scopes (use minimum required)
${scopeList}

## Runtime rules
- cloud (default): runs on Qlix servers. llmMode must be "proxy", localInferenceMode must be null.
- hybrid: Qlix-hosted but tool execution on the user's local machine (files, desktop apps). Use only when user mentions local files, apps, or desktop control. llmMode must be "proxy", localInferenceMode must be null.
- local: SDK-only, entirely on user's machine. llmMode can be "proxy" or "direct". localInferenceMode must be "local_llm" (local model) or "cloud_api" (proxy through Qlix).

## JIT scope rules
JIT-forced scopes: ${forceJitList || '(none)'}
- These MUST appear in BOTH permissionScopes AND jitScopes when requested.
- Non-JIT scopes go ONLY in permissionScopes, never in jitScopes.
- jitScopes must always be a subset of permissionScopes.

## Scope selection rule
Only request a scope when the agent's core task needs it. The dashboard and notifications are built-in delivery channels — never request a scope just to deliver results somewhere.
Connector-gated scopes (e.g. email, WhatsApp) MAY be requested even if the connector isn't linked yet — the user links it in Connectors and the link is verified when the agent runs. Request such a scope only when the task explicitly involves that channel.

## Defaults
- model: "openrouter/anthropic/claude-sonnet-4.6"
- runtime: "cloud"
- llmMode: "proxy"
- localInferenceMode: null`;
}
