import { ALL_PERMISSION_SCOPES, type PermissionScope } from './agents.types.js';
import { FORCE_JIT_SCOPES } from './jit.js';

const SCOPE_DESCRIPTIONS: Record<PermissionScope, string> = {
  'web.read': 'Read and navigate web pages, fetch URLs',
  'web.click': 'Click links and interact with web UIs',
  'web.transaction': 'Submit web forms, make online purchases',
  'system.file_read': 'Read files from the local filesystem',
  'system.file_write': 'Write or modify files on the local filesystem',
  'system.gui_control': 'Control desktop applications via screen automation',
  'finance.spend_50': 'Authorize financial transactions up to $50',
  'finance.spend_100': 'Authorize financial transactions up to $100',
  'brain.query': 'Query the organization AI brain for insights and answers',
  'brain.knowledge_read': 'Read documents indexed in the org knowledge base',
  'email.read': 'Read messages from a connected Gmail inbox',
  'email.send': 'Send emails via a connected Gmail account',
};

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

const AGENT_PROPERTIES_SCHEMA: Record<string, unknown> = {
  name: { type: 'string', description: 'Short descriptive name, e.g. "Web Researcher"', maxLength: 120 },
  description: {
    type: 'string',
    description: 'Task-specific system prompt for the agent. Be precise about what it does.',
    maxLength: 10000,
  },
  permissionScopes: {
    type: 'array',
    description: 'Minimum set of permission scopes required. JIT-forced scopes must also appear in jitScopes.',
    items: { type: 'string', enum: ALL_PERMISSION_SCOPES },
  },
  jitScopes: {
    type: 'array',
    description: 'Subset of permissionScopes requiring user approval on every invocation. Must include all JIT-forced scopes present in permissionScopes.',
    items: { type: 'string', enum: ALL_PERMISSION_SCOPES },
  },
  runtime: {
    type: 'string',
    enum: ['cloud', 'hybrid', 'local'],
    description: 'cloud = Qlix servers (default); hybrid = Qlix-hosted + local tool execution; local = SDK on user machine.',
  },
  model: { type: 'string', description: 'LLM model ID, e.g. "openrouter/anthropic/claude-3.5-sonnet"' },
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

export function buildAgentToolSchema(): Record<string, unknown> {
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
            properties: AGENT_PROPERTIES_SCHEMA,
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

export function buildTeamToolSchema(): Record<string, unknown> {
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
                properties: AGENT_PROPERTIES_SCHEMA,
                required: AGENT_REQUIRED,
                additionalProperties: false,
              },
              workers: {
                type: 'array',
                description: 'Specialized worker agents.',
                items: {
                  type: 'object',
                  properties: {
                    ...AGENT_PROPERTIES_SCHEMA,
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

export function buildSystemPrompt(): string {
  const forceJitSet = new Set<string>(FORCE_JIT_SCOPES);
  const scopeList = ALL_PERMISSION_SCOPES.map((s) => {
    const jitTag = forceJitSet.has(s) ? ' [JIT-forced]' : '';
    return `  ${s} — ${SCOPE_DESCRIPTIONS[s]}${jitTag}`;
  }).join('\n');
  const forceJitList = (FORCE_JIT_SCOPES as string[]).join(', ');

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
JIT-forced scopes: ${forceJitList}
- These MUST appear in BOTH permissionScopes AND jitScopes when requested.
- Non-JIT scopes go ONLY in permissionScopes, never in jitScopes.
- jitScopes must always be a subset of permissionScopes.

## Delivery channel rule — CRITICAL
WhatsApp, dashboard, and notifications are BUILT-IN delivery channels — never add permission scopes for them.
Only add email.send if the agent's core task is sending emails (e.g. "send marketing emails", "reply to customers").
Only add email.read if the agent must read the inbox (e.g. "monitor my inbox", "read emails").
NEVER add email.send or email.read just because the user wants results delivered somewhere.

## Defaults
- model: "openrouter/anthropic/claude-3.5-sonnet"
- runtime: "cloud"
- llmMode: "proxy"
- localInferenceMode: null`;
}
