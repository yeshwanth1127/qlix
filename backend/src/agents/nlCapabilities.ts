import type { ScopeDef } from './scopeCatalog.js';
import {
  renderNlPromptPacks,
  type NlPromptPackId,
} from './nlPromptPacks.js';

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

/** Short hints for the builder prompt — keep scope list compact. */
const BUILDER_HINTS: Record<string, string> = {
  'web.read': 'Browse pages / fetch URLs',
  'web.research': 'Structured web/social research APIs',
  'web.click': 'Click links/buttons',
  'web.transaction': 'Submit forms / checkouts',
  'system.file_read': 'Read local files',
  'system.file_write': 'Write local files',
  'system.gui_control': 'Desktop GUI / screen automation',
  'finance.spend_50': 'Spend up to $50',
  'finance.spend_100': 'Spend up to $100',
  'brain.query': 'Query org AI brain',
  'brain.knowledge_read': 'Read org knowledge docs',
  'email.read': 'Read Gmail',
  'email.send': 'Send Gmail',
  'whatsapp.send': 'Send files to linked WhatsApp self-chat',
  'whatsapp.read': 'Read WhatsApp chats/contacts',
  'whatsapp.contact_send': 'Message WhatsApp contacts',
  'social.read': 'Read Orbit social channels',
  'social.publish': 'Publish/schedule Orbit posts',
  'crm.read': 'Read CRM records',
  'crm.write': 'Create/update CRM records',
  'crm.delete': 'Delete CRM records',
  'slack.read': 'Read Slack',
  'slack.send': 'Write Slack',
};

function builderHint(scope: ScopeDef): string {
  if (BUILDER_HINTS[scope.id]) return BUILDER_HINTS[scope.id];
  // MCP / unknown: truncate catalog description.
  const raw = scope.description.trim();
  return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw || scope.label;
}

/** Agent property schema. Scope ids are validated in sanitize — no large enums here. */
function agentPropertiesSchema(): Record<string, unknown> {
  return {
    name: { type: 'string', description: 'Short name, e.g. Web Researcher', maxLength: 120 },
    description: {
      type: 'string',
      description: 'Task-specific system prompt for the agent.',
      maxLength: 10000,
    },
    permissionScopes: {
      type: 'array',
      description: 'Required scope ids from Available scopes. Include JIT-forced ids in jitScopes too.',
      items: { type: 'string' },
    },
    jitScopes: {
      type: 'array',
      description: 'Subset of permissionScopes needing per-use approval. Must include all JIT-forced scopes granted.',
      items: { type: 'string' },
    },
    runtime: {
      type: 'string',
      enum: ['cloud', 'hybrid', 'local'],
      description: 'cloud default; hybrid for local tools; local for on-device SDK.',
    },
    model: {
      type: 'string',
      description: 'Use exora/exora-general for cloud/hybrid unless user names another model.',
    },
    llmMode: {
      type: 'string',
      enum: ['proxy', 'direct'],
      description: 'proxy for cloud/hybrid; proxy or direct for local.',
    },
    localInferenceMode: {
      anyOf: [{ type: 'string', enum: ['local_llm', 'cloud_api'] }, { type: 'null' }],
      description: 'null for cloud/hybrid; local_llm or cloud_api for local.',
    },
    rationale: { type: 'string', description: 'Brief why for these choices.' },
  };
}

export function buildAgentToolSchema(_scopes?: ScopeDef[]): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: 'plan_single_agent',
      description: "Plan a single Qlix agent when the user describes ONE agent's purpose.",
      parameters: {
        type: 'object',
        properties: {
          rationale: { type: 'string', description: 'Why these permissions and runtime were chosen.' },
          agent: {
            type: 'object',
            properties: agentPropertiesSchema(),
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

export function buildTeamToolSchema(_scopes?: ScopeDef[]): Record<string, unknown> {
  const props = agentPropertiesSchema();
  return {
    type: 'function',
    function: {
      name: 'plan_team',
      description: 'Plan a supervisor + workers team for multiple coordinating agents or a pipeline.',
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
                description: 'Orchestrator that delegates and synthesizes.',
                properties: props,
                required: AGENT_REQUIRED,
                additionalProperties: false,
              },
              workers: {
                type: 'array',
                description: 'Specialized workers.',
                items: {
                  type: 'object',
                  properties: {
                    ...props,
                    role: {
                      type: 'string',
                      maxLength: 80,
                      description: 'Worker role, e.g. researcher.',
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

export function buildSystemPrompt(
  scopes: ScopeDef[],
  packs: readonly NlPromptPackId[] = [],
): string {
  const scopeList = scopes
    .map((s) => `  ${s.id} — ${builderHint(s)}${s.forceJit ? ' [JIT]' : ''}`)
    .join('\n');
  const forceJitList = scopes
    .filter((s) => s.forceJit)
    .map((s) => s.id)
    .join(', ');

  const core = `You are a Qlix agent configuration expert.
Call EXACTLY ONE tool: plan_single_agent (one agent) or plan_team (pipeline/team).

## Available scopes
${scopeList}

## Runtime
- cloud (default): Qlix servers. llmMode=proxy, localInferenceMode=null.
- hybrid: Qlix brain + local tools. Required for local files, desktop/GUI, screen automation. llmMode=proxy, localInferenceMode=null.
- local: on-device SDK. llmMode=proxy|direct; localInferenceMode=local_llm|cloud_api.

## Common combos
- Web research: web.research. Browse: web.read+web.click. Forms: +web.transaction.
- Request every scope the core task needs. Connector scopes OK before link. mcp.<server>.<tool> = MCP tools (bindings auto-created).

## JIT
Forced: ${forceJitList || '(none)'}
Include those in BOTH permissionScopes and jitScopes. Non-JIT only in permissionScopes. jitScopes ⊆ permissionScopes.

## Defaults
model=exora/exora-general (cloud/hybrid unless user pins another), runtime=cloud, llmMode=proxy, localInferenceMode=null`;

  return `${core}${renderNlPromptPacks(packs)}`;
}
