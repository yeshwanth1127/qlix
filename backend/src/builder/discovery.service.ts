import { z } from 'zod';
import { parsePlanningToolArguments } from '../agents/nlParse.js';
import {
  chatCompletion,
  LLM_APPLICATION_IDS,
  type LlmProviderId,
} from '../llm/inferenceRouter.js';
import { compileBuilderContext, type BuilderContextInput } from './contextCompiler.js';
import {
  REQUIREMENT_CATEGORIES,
  type DiscoveryOutcome,
} from './discovery.types.js';

const DISCOVERY_TOOL_NAME = 'record_discovery_turn';

const DEFAULT_DISCOVERY_MODEL = 'openrouter/openai/gpt-4o-mini';

const operationSchema = z.object({
  type: z.enum(['set', 'remove']).catch('set'),
  key: z.string().trim().min(1).max(100)
    .transform((value) => value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100))
    .pipe(z.string().min(1).regex(/^[a-z0-9_.-]+$/)),
  category: z.enum(REQUIREMENT_CATEGORIES).catch('assumption'),
  value: z.unknown().optional(),
  confidence: z.coerce.number().min(0).max(1).catch(0.8),
});

const unresolvedSchema = z.object({
  key: z.string().trim().min(1).max(100)
    .transform((value) => value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').slice(0, 100)),
  question: z.string().trim().min(1).max(500),
  blocking: z.boolean().catch(false),
});

const discoveryResponseSchema = z.object({
  reply: z.string().trim().min(1).max(4_000),
  operations: z.array(z.unknown()).max(30).catch([]),
  unresolved: z.array(z.unknown()).max(20).catch([]),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(20).catch([]),
  readiness: z.object({
    score: z.coerce.number().min(0).max(1).catch(0),
    canPlan: z.boolean().catch(false),
    blocking: z.array(z.string().trim().min(1).max(100)).max(20).catch([]),
  }).catch({ score: 0, canPlan: false, blocking: [] }),
  action: z.enum(['continue', 'ready', 'plan']).catch('continue'),
  summary: z.string().trim().max(2_000).catch(''),
});

function coerceDiscoveryPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw as Record<string, unknown>;
  const readiness = data.readiness && typeof data.readiness === 'object'
    ? data.readiness as Record<string, unknown>
    : {};
  return {
    reply: typeof data.reply === 'string' ? data.reply : String(data.reply ?? 'Understood — what else should this agent do?'),
    operations: Array.isArray(data.operations) ? data.operations : [],
    unresolved: Array.isArray(data.unresolved) ? data.unresolved : [],
    assumptions: Array.isArray(data.assumptions)
      ? data.assumptions.filter((item): item is string => typeof item === 'string')
      : [],
    readiness: {
      score: readiness.score ?? 0,
      canPlan: readiness.canPlan ?? false,
      blocking: Array.isArray(readiness.blocking) ? readiness.blocking : [],
    },
    action: data.action ?? 'continue',
    summary: typeof data.summary === 'string' ? data.summary : '',
  };
}

function parseOperations(raw: unknown[]): DiscoveryOutcome['operations'] {
  const out: DiscoveryOutcome['operations'] = [];
  for (const item of raw) {
    const parsed = operationSchema.safeParse(item);
    if (!parsed.success) continue;
    out.push({
      ...parsed.data,
      ...(parsed.data.type === 'remove' ? { value: undefined } : {}),
    });
  }
  return out;
}

function parseUnresolved(raw: unknown[]): DiscoveryOutcome['unresolved'] {
  const out: DiscoveryOutcome['unresolved'] = [];
  for (const item of raw) {
    const parsed = unresolvedSchema.safeParse(item);
    if (parsed.success && parsed.data.key) out.push(parsed.data);
  }
  return out;
}

/** Fill obvious facts when the model forgets to emit operations. */
export function inferMissingOperations(input: {
  currentMessage: string;
  existingKeys: Set<string>;
  operations: DiscoveryOutcome['operations'];
}): DiscoveryOutcome['operations'] {
  const text = input.currentMessage.toLowerCase();
  const have = new Set([...input.existingKeys, ...input.operations.map((op) => op.key)]);
  const extras: DiscoveryOutcome['operations'] = [...input.operations];
  const add = (key: string, category: DiscoveryOutcome['operations'][number]['category'], value: unknown) => {
    if (have.has(key)) return;
    have.add(key);
    extras.push({ type: 'set', key, category, value, confidence: 0.85 });
  };

  if (/email|inbox|gmail|outlook/.test(text)) {
    add('primary_objective', 'objective', 'Handle email');
    add('input_source', 'input', 'email inbox');
  }
  if (/read/.test(text) && /draft|reply/.test(text)) {
    add('output_action', 'output', 'read and draft replies');
  } else if (/draft/.test(text) && /reply/.test(text)) {
    add('output_action', 'output', 'draft replies');
  }
  if (/whatsapp/.test(text)) {
    add('notify_channel', 'output', 'whatsapp');
    add('output_action', 'output', 'send messages and collect replies');
  }
  if (/slack/.test(text) && /notif/.test(text)) {
    add('notify_channel', 'output', 'slack');
  }
  if (/lead|prospect|outreach|crm/.test(text)) {
    add('primary_objective', 'objective', 'Filter and outreach to leads');
  }
  if (/excel|spreadsheet|xlsx|csv/.test(text)) {
    add('input_source', 'input', 'excel spreadsheet');
  }
  if (/filter/.test(text) && /lead|list|row/.test(text)) {
    add('workflow', 'workflow', 'filter leads from list before outreach');
  }
  if (/repl(y|ies)|respond/.test(text)) {
    add('output_action', 'output', 'collect and record responses');
  }
  return extras;
}

function buildDiscoveryToolSchema() {
  return {
    type: 'function',
    function: {
      name: DISCOVERY_TOOL_NAME,
      description:
        'Record one discovery turn: a short user-facing reply plus structured requirement updates.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['reply', 'operations', 'unresolved', 'assumptions', 'readiness', 'action', 'summary'],
        properties: {
          reply: { type: 'string', description: '1-3 short sentences for the user' },
          operations: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type', 'key', 'category', 'confidence'],
              properties: {
                type: { type: 'string', enum: ['set', 'remove'] },
                key: { type: 'string' },
                category: { type: 'string', enum: [...REQUIREMENT_CATEGORIES] },
                value: {},
                confidence: { type: 'number' },
              },
            },
          },
          unresolved: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'question', 'blocking'],
              properties: {
                key: { type: 'string' },
                question: { type: 'string' },
                blocking: { type: 'boolean' },
              },
            },
          },
          assumptions: { type: 'array', items: { type: 'string' } },
          readiness: {
            type: 'object',
            required: ['score', 'canPlan', 'blocking'],
            properties: {
              score: { type: 'number' },
              canPlan: { type: 'boolean' },
              blocking: { type: 'array', items: { type: 'string' } },
            },
          },
          action: { type: 'string', enum: ['continue', 'ready', 'plan'] },
          summary: { type: 'string' },
        },
      },
    },
  };
}

const DISCOVERY_SYSTEM_PROMPT = `You are the discovery layer of the Qlix AI Builder.
Have a short, natural conversation that understands the user's workflow before any agent/team is designed.

Hard rules:
- Ask at most ONE question per turn. Prefer zero questions once the core is known.
- Never repeat a question the user already answered — including answers like "no", "nothing", "all", or "no preference".
- Treat "no"/"nothing"/"no preference" as a complete answer: record an assumption that there is no special filter, clear that topic, and move on.
- Core requirements only: objective, what the agent does (read/draft/send/etc), where data lives (email/CRM/etc), and optional notify channel. Defaults are fine for trigger (e.g. new emails) and "all types" when the user declines filters.
- Do NOT grill for optional niceties (keywords, sender types, tone, edge cases) after the user declines or after core is known.
- When objective + main actions are known, set canPlan=true and either ask once "Ready for me to design it?" or wait for the user to say design/build/proceed.
- Use DISTINCT stable snake_case keys (primary_objective, input_source, output_action, notify_channel, trigger, approval_policy). Corrections reuse the same key; unrelated facts never share a key.
- Keep replies to 1–3 short sentences. Never expose JSON, scores, tokens, agents, teams, models, or scopes.

Always call the ${DISCOVERY_TOOL_NAME} tool with your turn. Never answer in plain text.
action=plan only when canPlan is true AND the user explicitly asks to design/build/proceed/confirm now.
action=ready when canPlan is true but they have not asked to design yet.
action=continue only while a blocking gap remains.`;

function providerForModel(model: string): LlmProviderId {
  return model.toLowerCase().startsWith('exora/') ? 'exora' : 'openrouter';
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/** Accept tool args, legacy JSON, or plain prose from models that ignore structure. */
export function parseDiscoveryPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return coerceDiscoveryPayload({ reply: 'What should this agent do first?' });
  }

  try {
    return coerceDiscoveryPayload(JSON.parse(stripJsonFence(trimmed)));
  } catch {
    try {
      return coerceDiscoveryPayload(parsePlanningToolArguments(trimmed));
    } catch {
      console.warn('[builder-discovery] prose fallback', trimmed.slice(0, 300));
      return coerceDiscoveryPayload({ reply: trimmed });
    }
  }
}

function discoveryOutcomeFromPayload(
  parsed: unknown,
  input: BuilderContextInput,
): Omit<DiscoveryOutcome, 'usage' | 'model' | 'provider' | 'latencyMs'> {
  const validated = discoveryResponseSchema.safeParse(coerceDiscoveryPayload(parsed));
  if (!validated.success) {
    console.warn('[builder-discovery] schema mismatch', validated.error.issues.slice(0, 5));
    throw new BuilderDiscoveryError('The discovery model returned incomplete state. Please retry.');
  }

  return {
    ...validated.data,
    operations: inferMissingOperations({
      currentMessage: input.currentMessage,
      existingKeys: new Set(input.facts.map((fact) => fact.key)),
      operations: parseOperations(validated.data.operations),
    }),
    unresolved: parseUnresolved(validated.data.unresolved),
  };
}

export class BuilderDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuilderDiscoveryError';
  }
}

export async function runBuilderDiscovery(
  input: BuilderContextInput,
  options: { model?: string; planAllowedTiers?: string[] } = {},
): Promise<DiscoveryOutcome> {
  const model = options.model?.trim() || DEFAULT_DISCOVERY_MODEL;
  const startedAt = Date.now();
  const provider = providerForModel(model);
  const routeOptions = {
    provider,
    applicationId: LLM_APPLICATION_IDS.nlBuilder,
    timeoutMs: 60_000,
    retries: 0,
    planAllowedTiers: options.planAllowedTiers,
  };
  const request = {
    model,
    messages: [
      { role: 'system' as const, content: DISCOVERY_SYSTEM_PROMPT },
      { role: 'user' as const, content: compileBuilderContext(input) },
    ],
    temperature: 0.2,
    max_tokens: 900,
    stream: false as const,
    tools: [buildDiscoveryToolSchema()],
    tool_choice: 'required' as const,
  };

  let result = await chatCompletion(request, routeOptions);
  let payloadSource = result.toolCalls?.[0]?.function.arguments ?? result.content;

  if (!result.toolCalls?.[0]?.function.arguments?.trim()) {
    const repairModel = DEFAULT_DISCOVERY_MODEL;
    result = await chatCompletion(
      {
        ...request,
        model: repairModel,
        messages: [
          ...request.messages,
          {
            role: 'system' as const,
            content:
              `Your previous response did not call ${DISCOVERY_TOOL_NAME} with valid JSON arguments. ` +
              'Call that tool now with a complete discovery turn. Do not answer in plain text.',
          },
        ],
      },
      { ...routeOptions, provider: providerForModel(repairModel) },
    );
    payloadSource = result.toolCalls?.[0]?.function.arguments ?? result.content;
  }

  const outcome = discoveryOutcomeFromPayload(parseDiscoveryPayload(payloadSource), input);

  return {
    ...outcome,
    usage: {
      inputTokens: result.usage?.prompt_tokens ?? null,
      cachedInputTokens: result.usage?.prompt_tokens_details?.cached_tokens ?? null,
      outputTokens: result.usage?.completion_tokens ?? null,
    },
    model,
    provider: result.provider ?? provider,
    latencyMs: Date.now() - startedAt,
  };
}

export function enforceDiscoveryBoundary(
  outcome: DiscoveryOutcome,
  userTurnNumber: number,
): DiscoveryOutcome {
  // The first user request is always discovery, even if it says "build". This
  // is the product boundary that prevents the legacy instant-plan behavior.
  if (userTurnNumber <= 1 && outcome.action === 'plan') {
    return { ...outcome, action: outcome.readiness.canPlan ? 'ready' : 'continue' };
  }
  if (!outcome.readiness.canPlan && outcome.action !== 'continue') {
    return { ...outcome, action: 'continue' };
  }
  return outcome;
}

/** Redesign after a plan card: keep discovery memory, force plan when ready. */
export function applyRedesignIntent(outcome: DiscoveryOutcome): DiscoveryOutcome {
  if (!outcome.readiness.canPlan) return outcome;
  return { ...outcome, action: 'plan' };
}
