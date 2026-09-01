/**
 * Channel-agnostic prompt contract for conversation send/ask/collect nodes.
 * Channels render this (WhatsApp native poll, dashboard question, later Slack/email).
 * Inbound is always plain text regardless of how the prompt was presented.
 */

export type ConversationPrompt =
  | { kind: 'text'; content: string }
  | {
      kind: 'choice';
      content: string;
      options: string[];
      maxSelections?: number;
    };

export const CHOICE_MIN_OPTIONS = 2;
export const CHOICE_MAX_OPTIONS = 32;

export function isConversationPrompt(value: unknown): value is ConversationPrompt {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'text') return typeof raw.content === 'string';
  if (raw.kind === 'choice') {
    return typeof raw.content === 'string' && Array.isArray(raw.options);
  }
  return false;
}

export function parseConversationPrompt(value: unknown): ConversationPrompt | null {
  if (!isConversationPrompt(value)) return null;
  if (value.kind === 'text') {
    return { kind: 'text', content: value.content };
  }
  const maxSelections =
    typeof value.maxSelections === 'number' && Number.isFinite(value.maxSelections)
      ? value.maxSelections
      : undefined;
  return {
    kind: 'choice',
    content: value.content,
    options: value.options.map((option) => String(option)),
    ...(maxSelections !== undefined ? { maxSelections } : {}),
  };
}

export function textPrompt(content: string): ConversationPrompt {
  return { kind: 'text', content };
}

export function promptFromNode(node: { content: string; prompt?: ConversationPrompt }): ConversationPrompt {
  return node.prompt ?? textPrompt(node.content);
}

export function validateConversationPrompt(prompt: ConversationPrompt, nodeId: string): void {
  const content = prompt.content.trim();
  if (!content) {
    throw new Error(`Workflow node ${nodeId} prompt content is required`);
  }
  if (prompt.kind === 'text') return;
  const seen = new Set<string>();
  const options: string[] = [];
  for (const raw of prompt.options) {
    const option = String(raw ?? '').trim();
    if (!option) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }
  if (options.length < CHOICE_MIN_OPTIONS) {
    throw new Error(`Workflow node ${nodeId} choice prompt needs at least ${CHOICE_MIN_OPTIONS} options`);
  }
  if (options.length > CHOICE_MAX_OPTIONS) {
    throw new Error(`Workflow node ${nodeId} choice prompt allows at most ${CHOICE_MAX_OPTIONS} options`);
  }
  const maxSelections = prompt.maxSelections ?? 1;
  if (!Number.isInteger(maxSelections) || maxSelections < 1 || maxSelections > options.length) {
    throw new Error(`Workflow node ${nodeId} choice prompt has an invalid maxSelections`);
  }
}

function interpolateTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, variables);
    return value == null ? '' : String(value);
  });
}

export function interpolateConversationPrompt(
  prompt: ConversationPrompt,
  variables: Record<string, unknown>,
  contentOverride?: string,
): ConversationPrompt {
  const content = interpolateTemplate(contentOverride ?? prompt.content, variables);
  if (prompt.kind === 'text') return { kind: 'text', content };
  return {
    kind: 'choice',
    content,
    options: prompt.options.map((option) => interpolateTemplate(option, variables)),
    ...(prompt.maxSelections !== undefined ? { maxSelections: prompt.maxSelections } : {}),
  };
}

export function fallbackPromptFromContent(content: string, payloadPrompt: unknown): ConversationPrompt {
  return parseConversationPrompt(payloadPrompt) ?? textPrompt(content);
}
