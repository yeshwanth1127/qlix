import { chatCompletion, LLM_APPLICATION_IDS } from '../llm/inferenceRouter.js';
import { parseReasoningEffort } from '../llm/routing/reasoningBudget.js';
import type { PermissionScope } from '../agents/agents.types.js';
import type {
  TeamConfig,
  TeamDTO,
  TeamMemberDTO,
  TeamRunDTO,
  TeamRunInputPurpose,
} from './teams.types.js';
import { extractTeamRunUserGoal, lastResultFromEnvelope } from './teamRunFollowUp.js';

export type LunaTeamsKnowledgeMode = 'none' | 'reference_only' | 'required';

/** Runner skill_filter sentinel: load always-on meta tools only, no connectors. */
export const TEAM_DISPATCH_ONLY_SKILL = 'team.dispatch' as PermissionScope;

const SCOPE_FAMILIES: Array<{ pattern: RegExp; match: (scope: string) => boolean }> = [
  { pattern: /\b(whatsapp|outreach|poll|brochure|messenger)\b/i, match: (s) => s.startsWith('whatsapp') },
  { pattern: /\bemail\b/i, match: (s) => s.startsWith('email.') },
  { pattern: /\bcrm\b/i, match: (s) => s.startsWith('crm.') },
  { pattern: /\b(sheet|excel|spreadsheet)\b/i, match: (s) => s.startsWith('sheets.') || s === 'drive.write' },
  { pattern: /\b(notion)\b/i, match: (s) => s.startsWith('notion.') },
  { pattern: /\bslack\b/i, match: (s) => s.startsWith('slack.') },
  { pattern: /\b(research|browse|scrape)\b/i, match: (s) => s === 'web.research' || s.startsWith('web.') },
  { pattern: /\bschedule\b/i, match: (s) => s.includes('schedule') },
];

const CONNECTOR_DISPATCH_RE =
  /\b(whatsapp|email|crm|send|outreach|poll|brochure|research|browse|schedule|sheet|excel|notion|slack|messenger)\b/i;
const FILTER_ONLY_RE = /\b(filter|filtering|qualify|qualifying)\b/i;
const DOWNSTREAM_STAGE_RE =
  /\b(whatsapp|messenger|outreach|contact|crm|send|message|poll|brochure)\b/i;

function dispatchNeedsSourceFile(role: string, task: string, index: number): boolean {
  const text = `${role} ${task}`;
  if (FILTER_ONLY_RE.test(text) && !DOWNSTREAM_STAGE_RE.test(text)) return true;
  if (DOWNSTREAM_STAGE_RE.test(text) && !FILTER_ONLY_RE.test(text)) return false;
  return index === 0;
}

function withoutBrainUnlessRequired(
  scopes: PermissionScope[],
  knowledgeMode: LunaTeamsKnowledgeMode,
): PermissionScope[] {
  if (knowledgeMode === 'required') return scopes;
  return scopes.filter((scope) => scope !== 'brain.query' && !scope.startsWith('brain.'));
}

/** Smallest delegated-scope subset that can complete this task. Empty = JSON-only. */
export function heuristicAllowedScopes(params: {
  role: string;
  task: string;
  delegatedScopes: PermissionScope[];
  knowledgeMode: LunaTeamsKnowledgeMode;
}): PermissionScope[] {
  const scopes = withoutBrainUnlessRequired(params.delegatedScopes, params.knowledgeMode);
  const text = `${params.role} ${params.task}`;
  if (FILTER_ONLY_RE.test(text) && !CONNECTOR_DISPATCH_RE.test(text)) return [];
  const matched = SCOPE_FAMILIES.flatMap((family) =>
    family.pattern.test(text) ? scopes.filter((scope) => family.match(scope)) : [],
  );
  if (matched.length > 0) return [...new Set(matched)];
  if (CONNECTOR_DISPATCH_RE.test(text)) return scopes;
  return [];
}

/**
 * Host-enforced allowlist. Commander requests ∩ delegatedScopes ∩ task heuristic.
 * Omitted `requested` falls back to the heuristic. Empty means no connector tools.
 */
export function resolveDispatchAllowedScopes(params: {
  role: string;
  task: string;
  delegatedScopes: PermissionScope[];
  knowledgeMode: LunaTeamsKnowledgeMode;
  requested?: string[] | null;
}): PermissionScope[] {
  const heuristic = heuristicAllowedScopes(params);
  if (!Array.isArray(params.requested)) {
    return heuristic;
  }
  const granted = new Set(params.delegatedScopes);
  const fromCommander = [...new Set(
    params.requested.filter((scope): scope is PermissionScope =>
      granted.has(scope as PermissionScope),
    ),
  )];
  return withoutBrainUnlessRequired(
    fromCommander.filter((scope) => heuristic.includes(scope)),
    params.knowledgeMode,
  );
}

export function skillsForLunaTeamsDispatch(params: {
  role?: string;
  task?: string;
  delegatedScopes?: PermissionScope[];
  knowledgeMode?: LunaTeamsKnowledgeMode;
  allowedScopes?: PermissionScope[];
}): PermissionScope[] {
  const allowed =
    params.allowedScopes ??
    heuristicAllowedScopes({
      role: params.role ?? '',
      task: params.task ?? '',
      delegatedScopes: params.delegatedScopes ?? [],
      knowledgeMode: params.knowledgeMode ?? 'none',
    });
  return allowed.length > 0 ? allowed : [TEAM_DISPATCH_ONLY_SKILL];
}

export const DEFAULT_RESULT_CONTRACT: Record<string, unknown> = {
  type: 'object',
  required: ['summary', 'findings', 'provenance'],
  properties: {
    summary: { type: 'string' },
    findings: {},
    provenance: {
      type: 'object',
      required: ['inputRefs', 'recordRefs', 'knowledgeRefs'],
      properties: {
        inputRefs: { type: 'array', items: { type: 'string' } },
        recordRefs: { type: 'array', items: { type: 'string' } },
        knowledgeRefs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

export interface LunaTeamsDispatch {
  dispatchId: string;
  agentId: string;
  agentName: string;
  role: string;
  task: string;
  delegatedScopes: PermissionScope[];
  /** Subset of delegatedScopes for this task. Empty = no connector tools. */
  allowedScopes: PermissionScope[];
  stageOrder: number;
  contractId?: string;
  inputRefs: string[];
  allowedSources: TeamRunInputPurpose[];
  knowledgeMode: LunaTeamsKnowledgeMode;
  outputContract: Record<string, unknown>;
}

export interface LunaTeamsHandback {
  summary: string;
  payload: unknown;
  text: string;
  truncated?: boolean;
}

export interface LunaTeamsProvenance {
  inputRefs: string[];
  recordRefs: string[];
  knowledgeRefs: string[];
}

export interface ValidatedLunaTeamsResult {
  data: unknown;
  provenance: LunaTeamsProvenance;
}

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

function fallbackDispatches(
  run: TeamRunDTO,
  members: TeamMemberDTO[],
): LunaTeamsDispatch[] {
  const authoritativeRefs = run.inputs
    .filter((input) => input.purpose === 'authoritative_input')
    .map((input) => input.ref);
  const objective = extractTeamRunUserGoal(run.goal) || run.goal;
  return members.map((member, index) => {
    const task =
      index === 0
        ? `Perform the ${member.role} part of this objective and return only the information the next specialist needs: ${objective}`
        : `Continue the objective using only the Result handbacks supplied by Luna-Teams. Perform the ${member.role} part; do not repeat earlier work.`;
    return {
      dispatchId: `dispatch_${index + 1}_${member.agentId.slice(0, 8)}`,
      agentId: member.agentId,
      agentName: member.agent?.name ?? member.agentId,
      role: member.role,
      task,
      delegatedScopes: member.delegatedScopes,
      allowedScopes: resolveDispatchAllowedScopes({
        role: member.role,
        task,
        delegatedScopes: member.delegatedScopes,
        knowledgeMode: 'none',
      }),
      stageOrder: member.stageOrder,
      inputRefs: index === 0 ? authoritativeRefs : [],
      allowedSources: ['authoritative_input'] as TeamRunInputPurpose[],
      knowledgeMode: 'none' as const,
      outputContract: DEFAULT_RESULT_CONTRACT,
    };
  });
}

/**
 * One backend-side commander decision. Individual agents and their runners never
 * receive commander tools or roster metadata.
 */
export async function planLunaTeamsDispatches(
  run: TeamRunDTO,
  team: TeamDTO,
  orderedMembers: TeamMemberDTO[],
): Promise<LunaTeamsDispatch[]> {
  const preserveOrder = !(team.config as TeamConfig).autoSequence;
  const roster = orderedMembers
    .map(
      (member) =>
        `- id=${member.agentId}; name=${member.agent?.name ?? member.agentId}; ` +
        `role=${member.role}; stage=${member.stageOrder}; scopes=${member.delegatedScopes.join(', ') || 'none'}`,
    )
    .join('\n');
  const inputs = run.inputs.length > 0
    ? run.inputs
        .map((input) => `- ref=${input.ref}; purpose=${input.purpose}; file=${input.fileName}; mime=${input.mimeType}`)
        .join('\n')
    : '- none';

  try {
    const result = await chatCompletion(
      {
        model: (team.config as TeamConfig).defaultModel ?? 'openrouter/qlix/auto',
        messages: [
          {
            role: 'system',
            content: `You are the Luna-Teams commander host.
Create short, self-contained dispatch contracts for existing agents.
The Intent/Objective is authoritative. If this is a retry, execute that same intent — do not rewrite it as "re-attempt filtering" or drop constraints (city, channel, greeting/brochure/poll, contacts).
Each task must carry the constraints relevant to that member (for example Bangalore/Bengaluru for the filter stage; greeting then brochure then poll for WhatsApp).
Never invent agents or scopes.
allowedScopes must be a subset of that member's roster scopes. Use the smallest set that can complete the task. Use [] when the member can finish from extracted inputs or Result handbacks with no connector. Do not include write, research, or schedule scopes unless the task explicitly needs them.
Use only input refs from the supplied input catalog. Only the source/filter stage should receive authoritative_input refs. Later stages (WhatsApp, contacts, CRM) must set inputRefs to [] and use Result handbacks. Operational records must come from authoritative_input or those handbacks.
Knowledge mode is "none" by default, "reference_only" when a selected reference asset is needed, or "required" only when Brain knowledge is explicitly necessary.
Return only a JSON array: [{"agentId":"...","task":"...","inputRefs":["team-input:..."],"allowedSources":["authoritative_input"],"allowedScopes":[],"knowledgeMode":"none","contractId":"optional","outputContract":{...}}].
${preserveOrder ? 'Use every roster member exactly once and preserve roster order.' : 'You may reorder or omit members when their role is unnecessary.'}`,
          },
          {
            role: 'user',
            content: [
              `Team: ${team.name}`,
              `Intent (authoritative): ${extractTeamRunUserGoal(run.goal) || run.goal}`,
              lastResultFromEnvelope(run.goal)
                ? `Last attempt: ${lastResultFromEnvelope(run.goal)}`
                : null,
              `Input catalog:\n${inputs}`,
              `Roster:\n${roster}`,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        temperature: 0.1,
        max_tokens: 1600,
        stream: false,
        reasoning_purpose: 'planning',
        ...(parseReasoningEffort((team.config as TeamConfig).defaultReasoningEffort)
          ? {
              reasoning_effort: parseReasoningEffort(
                (team.config as TeamConfig).defaultReasoningEffort,
              )!,
            }
          : {}),
      },
      {
        applicationId: LLM_APPLICATION_IDS.lunaTeams,
        timeoutMs: 30_000,
        retries: 1,
      },
    );
    const parsed = JSON.parse(stripCodeFence(result.content)) as Array<{
      agentId?: string;
      task?: string;
      contractId?: string;
      inputRefs?: string[];
      allowedSources?: TeamRunInputPurpose[];
      allowedScopes?: string[];
      knowledgeMode?: LunaTeamsKnowledgeMode;
      outputContract?: Record<string, unknown>;
    }>;
    const memberById = new Map(orderedMembers.map((member) => [member.agentId, member]));
    const seen = new Set<string>();
    const validInputRefs = new Set(run.inputs.map((input) => input.ref));
    const selected = parsed.flatMap((item, index): LunaTeamsDispatch[] => {
      const member = item.agentId ? memberById.get(item.agentId) : undefined;
      const task = item.task?.trim();
      if (!member || !task || seen.has(member.agentId)) return [];
      let inputRefs = (item.inputRefs ?? []).filter((ref) => validInputRefs.has(ref));
      const sourceStage = dispatchNeedsSourceFile(member.role, task, index);
      if (sourceStage && inputRefs.length === 0) {
        inputRefs = run.inputs
          .filter((input) => input.purpose === 'authoritative_input' && validInputRefs.has(input.ref))
          .map((input) => input.ref);
      }
      if (!sourceStage) inputRefs = [];
      const allowedSources = (item.allowedSources ?? ['authoritative_input']).filter(
        (source): source is TeamRunInputPurpose =>
          source === 'authoritative_input' || source === 'reference_asset',
      );
      const knowledgeMode: LunaTeamsKnowledgeMode =
        item.knowledgeMode === 'reference_only' || item.knowledgeMode === 'required'
          ? item.knowledgeMode
          : 'none';
      seen.add(member.agentId);
      return [{
        dispatchId: `dispatch_${index + 1}_${member.agentId.slice(0, 8)}`,
        agentId: member.agentId,
        agentName: member.agent?.name ?? member.agentId,
        role: member.role,
        task,
        delegatedScopes: member.delegatedScopes,
        allowedScopes: resolveDispatchAllowedScopes({
          role: member.role,
          task,
          delegatedScopes: member.delegatedScopes,
          knowledgeMode,
          requested: item.allowedScopes,
        }),
        stageOrder: preserveOrder ? member.stageOrder : index + 1,
        ...(item.contractId?.trim() ? { contractId: item.contractId.trim() } : {}),
        inputRefs,
        allowedSources: allowedSources.length > 0 ? allowedSources : ['authoritative_input'],
        knowledgeMode,
        outputContract: effectiveOutputContract(item.outputContract),
      }];
    });
    if (
      selected.length > 0 &&
      (!preserveOrder || selected.length === orderedMembers.length)
    ) {
      return preserveOrder
        ? orderedMembers.map(
            (member) => selected.find((item) => item.agentId === member.agentId)!,
          )
        : selected;
    }
  } catch (error) {
    console.warn(
      '[LunaTeams] commander planning failed; using deterministic dispatches:',
      error instanceof Error ? error.message : error,
    );
  }
  return fallbackDispatches(run, orderedMembers);
}

function extractBalancedJson(text: string): { json: string; truncated: boolean } | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return { json: text.slice(start, i + 1), truncated: false };
      }
    }
  }
  return { json: text.slice(start), truncated: true };
}

export function parseLunaTeamsHandback(raw: string): LunaTeamsHandback {
  const text = raw.trim();
  const extracted = extractBalancedJson(text);
  if (extracted?.truncated) {
    return {
      summary: text.slice(0, 200),
      payload: { text, truncated: true },
      text,
      truncated: true,
    };
  }
  try {
    const payload = JSON.parse(extracted?.json ?? text) as unknown;
    const record =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null;
    const summary =
      typeof record?.summary === 'string'
        ? record.summary
        : text.slice(0, 200);
    return { summary, payload, text };
  } catch {
    return { summary: text.slice(0, 200), payload: { text }, text };
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function effectiveOutputContract(raw?: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || raw.type !== 'object') {
    return DEFAULT_RESULT_CONTRACT;
  }
  return raw;
}

export function isEmptyWorkerHandback(payload: unknown): boolean {
  if (payload == null) return true;
  if (typeof payload === 'string') {
    return !payload.trim() || /^no response generated\.?$/i.test(payload.trim());
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) return false;
  const record = payload as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const hasResultKeys = 'summary' in record || 'findings' in record || 'provenance' in record;
  return !hasResultKeys && (!text || /^no response generated\.?$/i.test(text));
}

function assertContract(value: unknown, schema: Record<string, unknown>, path = 'result'): void {
  const expected = schema.type;
  if (expected === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${path} must be an object`);
    }
    const record = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in record)) throw new Error(`${path}.${key} is required`);
    }
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    for (const [key, child] of Object.entries(properties ?? {})) {
      if (key in record) assertContract(record[key], child, `${path}.${key}`);
    }
  } else if (expected === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    const itemSchema = schema.items as Record<string, unknown> | undefined;
    if (itemSchema) value.forEach((item, index) => assertContract(item, itemSchema, `${path}[${index}]`));
  } else if (expected === 'string' && typeof value !== 'string') {
    throw new Error(`${path} must be a string`);
  }
}

function collectOperationalRecords(value: unknown, parentKey = ''): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.every((item) => item && typeof item === 'object' && !Array.isArray(item)) &&
      /^(leads|contacts|recipients|targets|records|rows|findings|data)?$/i.test(parentKey)
    ) {
      return value as Record<string, unknown>[];
    }
    return value.flatMap((item) => collectOperationalRecords(item, parentKey));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectOperationalRecords(child, key),
  );
}

function phoneTokens(source: string): string[] {
  return [...source.matchAll(/\+?\d[\d\s().-]{6,18}\d/g)].map((match) => match[0].replace(/\D/g, ''));
}

function phonesMatch(source: string, value: string): boolean {
  const valueDigits = String(value).replace(/\D/g, '');
  if (valueDigits.length < 8) return false;
  const tokens = phoneTokens(source);
  if (tokens.length === 0) {
    return source.replace(/\D/g, '').includes(valueDigits);
  }
  return tokens.some(
    (token) =>
      token.length >= 8 &&
      (token === valueDigits || token.endsWith(valueDigits) || valueDigits.endsWith(token)),
  );
}

function sourceContains(source: string, key: string, value: string | number): boolean {
  if (/phone|recipient|whatsapp|mobile/i.test(key)) {
    return phonesMatch(source, String(value));
  }
  return source.toLocaleLowerCase().includes(String(value).trim().toLocaleLowerCase());
}

function priorProvenanceRefs(priorHandbacks: unknown[] | undefined): {
  inputRefs: Set<string>;
  recordRefs: Set<string>;
} {
  const inputRefs = new Set<string>();
  const recordRefs = new Set<string>();
  for (const handback of priorHandbacks ?? []) {
    if (!handback || typeof handback !== 'object') continue;
    const envelope = handback as {
      provenance?: { inputRefs?: unknown; recordRefs?: unknown };
      data?: { provenance?: { inputRefs?: unknown; recordRefs?: unknown } };
    };
    const provenance = envelope.provenance ?? envelope.data?.provenance;
    if (Array.isArray(provenance?.inputRefs)) {
      for (const ref of provenance.inputRefs) {
        if (typeof ref === 'string') inputRefs.add(ref);
      }
    }
    if (Array.isArray(provenance?.recordRefs)) {
      for (const ref of provenance.recordRefs) {
        if (typeof ref === 'string') recordRefs.add(ref);
      }
    }
  }
  return { inputRefs, recordRefs };
}

export function validateLunaTeamsResult(params: {
  payload: unknown;
  dispatch: Pick<LunaTeamsDispatch, 'inputRefs' | 'allowedSources' | 'knowledgeMode' | 'outputContract'>;
  run: TeamRunDTO;
  priorHandbacks?: unknown[];
}): ValidatedLunaTeamsResult {
  if (isEmptyWorkerHandback(params.payload)) {
    throw new Error('Worker did not return a Result envelope');
  }
  if (
    params.payload &&
    typeof params.payload === 'object' &&
    !Array.isArray(params.payload) &&
    (params.payload as { truncated?: unknown }).truncated === true
  ) {
    throw new Error('Worker Result JSON was cut off');
  }
  assertContract(params.payload, effectiveOutputContract(params.dispatch.outputContract));
  const record = params.payload as Record<string, unknown>;
  const provenanceRaw = record.provenance as Record<string, unknown>;
  if (
    !isStringArray(provenanceRaw?.inputRefs) ||
    !isStringArray(provenanceRaw?.recordRefs) ||
    !isStringArray(provenanceRaw?.knowledgeRefs)
  ) {
    throw new Error('Result provenance arrays are required');
  }
  const provenance: LunaTeamsProvenance = {
    inputRefs: [...new Set(provenanceRaw.inputRefs)],
    recordRefs: [...new Set(provenanceRaw.recordRefs)],
    knowledgeRefs: [...new Set(provenanceRaw.knowledgeRefs)],
  };
  const allowedRefs = new Set(params.dispatch.inputRefs);
  const priorRefs = priorProvenanceRefs(params.priorHandbacks);
  const lineageOnly =
    allowedRefs.size === 0 &&
    provenance.inputRefs.length > 0 &&
    provenance.inputRefs.every((ref) => priorRefs.inputRefs.has(ref));
  if (provenance.inputRefs.some((ref) => !allowedRefs.has(ref)) && !lineageOnly) {
    throw new Error(
      allowedRefs.size === 0
        ? 'Result cites a source file but this dispatch has no attached input'
        : 'Result cites an input outside its dispatch contract',
    );
  }
  if (params.dispatch.knowledgeMode === 'none' && provenance.knowledgeRefs.length > 0) {
    throw new Error('Result cites knowledge while Brain is disabled');
  }

  const inputByRef = new Map(params.run.inputs.map((input) => [input.ref, input]));
  const authoritative = params.dispatch.inputRefs
    .map((ref) => inputByRef.get(ref))
    .filter((input) => input?.purpose === 'authoritative_input');
  const operationalRecords = collectOperationalRecords(record.findings ?? record.data);
  if (operationalRecords.length > 0) {
    const sourceText =
      authoritative.length > 0
        ? authoritative.map((input) => input!.extractedText ?? '').join('\n')
        : JSON.stringify(params.priorHandbacks ?? []);
    if (authoritative.length === 0) {
      if (!params.priorHandbacks?.length || provenance.recordRefs.length === 0) {
        throw new Error('Operational records require a prior Result handback and row lineage');
      }
      if (provenance.recordRefs.some((ref) => !priorRefs.recordRefs.has(ref))) {
        throw new Error('Result cites row lineage that is not in a prior Result');
      }
    } else if (provenance.recordRefs.length === 0) {
      throw new Error('Operational records require authoritative input and row lineage');
    }
    const identityKeys = /^(name|phone|mobile|email|city|address|recipient|whatsapp)$/i;
    for (const operationalRecord of operationalRecords) {
      for (const [key, value] of Object.entries(operationalRecord)) {
        if (
          identityKeys.test(key) &&
          (typeof value === 'string' || typeof value === 'number') &&
          !sourceContains(sourceText, key, value)
        ) {
          throw new Error(
            authoritative.length > 0
              ? `Operational value "${String(value)}" is absent from authoritative input`
              : `Operational value "${String(value)}" is absent from prior Result data`,
          );
        }
      }
    }
  }
  return { data: params.payload, provenance };
}

export function renderResultHandbacks(
  handbacks: Array<{ agentName: string; payload: unknown }>,
): string {
  if (handbacks.length === 0) return '';
  return [
    'Luna-Teams Result handbacks (authoritative; do not re-read or broaden their source data):',
    ...handbacks.map(
      (item) => `[${item.agentName}] ${JSON.stringify(item.payload)}`,
    ),
  ].join('\n');
}

export function renderLunaTeamsFinal(
  results: Array<{ agentName: string; summary: string; findings: string; status: string }>,
): string {
  const completed = results.filter((result) => result.status === 'completed');
  if (completed.length === 0) {
    throw new Error('All team dispatches failed');
  }
  const last = completed[completed.length - 1]!;
  if (completed.length === 1) {
    return last.findings.trim() || last.summary.trim();
  }
  const progress = completed
    .slice(0, -1)
    .map((result) => `${result.agentName}: ${result.summary}`)
    .join('\n');
  const finalResult = last.findings.trim() || last.summary.trim();
  return `Team completed ${completed.length} dispatches.\n${progress}\n\nFinal result from ${last.agentName}:\n${finalResult}`;
}
