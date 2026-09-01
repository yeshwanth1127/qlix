import type {
  BuilderRequirementsState,
  BuilderReadinessState,
  RequirementFactView,
} from './discovery.types.js';

const MAX_FACT_CHARS = 6_000;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_TOPIC_CHARS = 2_000;
const MAX_RECENT_CHARS = 5_000;

export interface ContextMessage {
  role: string;
  content: string;
  sequence: number;
}

export interface TopicSummaryView {
  topic: string;
  content: string;
}

export interface BuilderContextInput {
  phase: string;
  facts: RequirementFactView[];
  unresolved: BuilderRequirementsState['unresolved'];
  assumptions: string[];
  readiness: BuilderReadinessState;
  rollingSummary: string;
  topicSummaries?: TopicSummaryView[];
  recentMessages: ContextMessage[];
  currentMessage: string;
  /** Total stored messages in the session (used for tier selection). */
  messageCount?: number;
}

export type ContextTier = 'short' | 'medium' | 'long';

export function selectContextTier(messageCount: number): ContextTier {
  if (messageCount <= 10) return 'short';
  if (messageCount <= 40) return 'medium';
  return 'long';
}

function clippedJson(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return serialized;
  return `${serialized.slice(0, maxChars)}…`;
}

function selectRecent(messages: ContextMessage[], limit: number): ContextMessage[] {
  const selected: ContextMessage[] = [];
  let chars = 0;
  for (const message of [...messages].sort((a, b) => b.sequence - a.sequence)) {
    if (selected.length >= limit) break;
    const content = message.content.slice(0, 2_000);
    if (selected.length > 0 && chars + content.length > MAX_RECENT_CHARS) break;
    selected.push({ ...message, content });
    chars += content.length;
  }
  return selected.reverse();
}

/**
 * Deterministic topic blurbs from active facts. These accelerate context without
 * replacing the fact ledger as source of truth.
 */
export function topicSummariesFromFacts(facts: RequirementFactView[]): TopicSummaryView[] {
  const groups = new Map<string, string[]>();
  for (const fact of facts) {
    const label = typeof fact.value === 'string'
      ? fact.value
      : JSON.stringify(fact.value);
    const line = `${fact.key}: ${label}`.slice(0, 240);
    const bucket = groups.get(fact.category) ?? [];
    bucket.push(line);
    groups.set(fact.category, bucket);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, lines]) => ({
      topic,
      content: lines.slice(0, 8).join('; ').slice(0, 600),
    }));
}

/**
 * Produces a bounded, deterministic context. Canonical facts are always ahead
 * of conversational wording, so long sessions do not grow the prompt forever.
 */
export function compileBuilderContext(input: BuilderContextInput): string {
  const tier = selectContextTier(input.messageCount ?? input.recentMessages.length + 1);
  const recentLimit = tier === 'short' ? 10 : tier === 'medium' ? 6 : 4;
  const includeTopics = tier !== 'short';
  const includeRolling = tier !== 'short' || Boolean(input.rollingSummary.trim());

  const facts = [...input.facts]
    .sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key))
    .map(({ key, category, value, confidence }) => ({ key, category, value, confidence }));
  const blocking = [
    ...input.readiness.blocking,
    ...input.unresolved.filter((item) => item.blocking).map((item) => item.key),
  ];
  const topics = (input.topicSummaries ?? topicSummariesFromFacts(input.facts))
    .slice(0, tier === 'long' ? 8 : 5)
    .map(({ topic, content }) => ({ topic, content: content.slice(0, 400) }));
  const recent = selectRecent(input.recentMessages, recentLimit).map(({ role, content, sequence }) => ({
    sequence,
    role,
    content,
  }));

  const blocks = [
    `PHASE: ${input.phase}`,
    `CONTEXT_TIER: ${tier}`,
    `ACTIVE_REQUIREMENTS: ${clippedJson(facts, MAX_FACT_CHARS)}`,
    `UNRESOLVED: ${clippedJson(input.unresolved, 1_500)}`,
    `BLOCKING: ${clippedJson(blocking, 800)}`,
    `ASSUMPTIONS: ${clippedJson(input.assumptions, 1_000)}`,
    `READINESS: ${clippedJson(input.readiness, 800)}`,
  ];
  if (includeRolling) {
    blocks.push(`ROLLING_SUMMARY: ${input.rollingSummary.slice(0, MAX_SUMMARY_CHARS) || '(none yet)'}`);
  }
  if (includeTopics) {
    blocks.push(`TOPIC_SUMMARIES: ${clippedJson(topics, MAX_TOPIC_CHARS)}`);
  }
  blocks.push(`RECENT_MESSAGES: ${clippedJson(recent, MAX_RECENT_CHARS + 1_000)}`);
  blocks.push(`CURRENT_USER_MESSAGE: ${input.currentMessage.slice(0, 5_000)}`);
  return blocks.join('\n');
}

export function requirementsToPlanningBrief(
  facts: RequirementFactView[],
  summary: string,
  assumptions: string[],
): string {
  const grouped: Record<string, Array<{ key: string; value: unknown }>> = {};
  for (const fact of facts) {
    (grouped[fact.category] ??= []).push({ key: fact.key, value: fact.value });
  }
  return [
    'Design an agent or team from these confirmed discovery requirements.',
    `Discovery summary: ${summary.slice(0, 2_000)}`,
    `Requirements: ${clippedJson(grouped, 8_000)}`,
    `Assumptions: ${clippedJson(assumptions, 1_500)}`,
  ].join('\n');
}
