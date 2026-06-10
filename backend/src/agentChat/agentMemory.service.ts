import { prisma } from '../lib/prisma.js';
import { openRouterChatCompletion } from '../llm/openrouterClient.js';
import { normalizeQlixInferenceModelId } from '../llm/modelPolicy.js';

// Stage 1 "foundation" memory. Four kinds delivered through one text block:
//  - working  : recent conversation turns (reused from AgentMessage, not stored here)
//  - fact     : durable things known about the user (semantic)
//  - episode  : one-line summary of a past run (episodic)
//  - recipe   : an approach/tools that worked for a kind of task (procedural)
// Plain text, no embeddings. Recall = "load the recent rows", write = automatic after a run.

const WORKING_MESSAGES = 10;
const FACT_LIMIT = 20;
const EPISODE_LIMIT = 5;
const RECIPE_LIMIT = 5;
const MAX_MSG_CHARS = 1500;
/** Hard cap on the rolling conversation summary; it re-compresses to stay under this. */
const MAX_SUMMARY_CHARS = 2000;
/** Overall budget for the assembled memory block; oldest verbatim chat is trimmed first. */
const MAX_BLOCK_CHARS = 6000;

/** Cheap model for the after-run extraction; override via env if desired. */
const MEMORY_MODEL = process.env.QLIX_MEMORY_MODEL?.trim() || 'openrouter/openai/gpt-4o-mini';

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function stripJsonFence(value: string): string {
  const text = value.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/**
 * Assemble everything this agent remembers for this user into one block of text.
 * Returns null when there is nothing to remember yet (brand-new conversation, no facts).
 * The runner prepends this exactly like the org Brain context block.
 */
export async function buildMemoryBlock(input: {
  agentId: string;
  userId: string;
  conversationId: string;
  currentPrompt: string;
}): Promise<string | null> {
  const [recentDesc, memories, conversation] = await Promise.all([
    prisma.agentMessage.findMany({
      where: { conversationId: input.conversationId },
      orderBy: { createdAt: 'desc' },
      take: WORKING_MESSAGES + 2,
      select: { role: true, content: true },
    }),
    prisma.agentMemory.findMany({
      where: { agentId: input.agentId, userId: input.userId },
      orderBy: { createdAt: 'desc' },
      take: FACT_LIMIT + EPISODE_LIMIT + RECIPE_LIMIT + 20,
      select: { kind: true, content: true },
    }),
    prisma.agentConversation.findUnique({
      where: { id: input.conversationId },
      select: { summary: true },
    }),
  ]);

  // Oldest-first, and drop the just-enqueued current prompt (it's shown separately as the task).
  const recent = recentDesc.reverse();
  const tail = recent[recent.length - 1];
  if (tail && tail.role === 'user' && tail.content.trim() === input.currentPrompt.trim()) {
    recent.pop();
  }
  const working = recent.slice(-WORKING_MESSAGES);

  const facts = memories.filter((m) => m.kind === 'fact').slice(0, FACT_LIMIT);
  const recipes = memories.filter((m) => m.kind === 'recipe').slice(0, RECIPE_LIMIT);
  const episodes = memories.filter((m) => m.kind === 'episode').slice(0, EPISODE_LIMIT);

  // High-priority sections (kept whole within budget).
  const fixedSections: string[] = [];
  if (facts.length > 0) {
    fixedSections.push(
      ['What you know about this user:', ...facts.map((f) => `- ${clip(f.content, 300)}`)].join('\n'),
    );
  }
  if (recipes.length > 0) {
    fixedSections.push(
      ['Approaches that worked before:', ...recipes.map((r) => `- ${clip(r.content, 400)}`)].join('\n'),
    );
  }
  if (episodes.length > 0) {
    fixedSections.push(
      ['What happened in past tasks:', ...episodes.map((e) => `- ${clip(e.content, 300)}`)].join('\n'),
    );
  }

  const summaryLine = conversation?.summary?.trim()
    ? `Earlier conversation (summary): ${clip(conversation.summary, MAX_SUMMARY_CHARS)}`
    : null;
  const workingLines = working.map((m) => {
    const who = m.role === 'user' ? 'User' : m.role === 'agent' ? 'You' : 'System';
    return `${who}: ${clip(m.content, MAX_MSG_CHARS)}`;
  });

  if (fixedSections.length === 0 && !summaryLine && workingLines.length === 0) return null;

  const header = '## Memory (things you remember about this user and past work)';
  const assemble = (wLines: string[]): string => {
    const all = [...fixedSections];
    const convo: string[] = [];
    if (summaryLine) convo.push(summaryLine);
    if (wLines.length > 0) convo.push('Recent conversation:', ...wLines);
    if (convo.length > 0) all.push(convo.join('\n'));
    return [header, '', all.join('\n\n')].join('\n');
  };

  // Budget: drop the oldest verbatim chat lines first until under budget; hard-clip as a backstop.
  let lines = workingLines;
  let block = assemble(lines);
  while (block.length > MAX_BLOCK_CHARS && lines.length > 0) {
    lines = lines.slice(1);
    block = assemble(lines);
  }
  if (block.length > MAX_BLOCK_CHARS) block = `${block.slice(0, MAX_BLOCK_CHARS)}\n…`;
  return block;
}

/**
 * Stage 2 compaction. Fold messages that have dropped out of the recent window into a
 * short rolling summary on the conversation row. Fire-and-forget; never throws into the
 * caller. Uses the dedicated cheap model (never the agent's inference model) and keeps the
 * summary under a hard char cap by re-compressing it each time.
 */
export async function updateConversationSummary(conversationId: string): Promise<void> {
  const convo = await prisma.agentConversation.findUnique({
    where: { id: conversationId },
    select: { summary: true, summarizedCount: true },
  });
  if (!convo) return;

  const messages = await prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });

  // Everything older than the recent verbatim window should live in the summary.
  const foldUpTo = messages.length - WORKING_MESSAGES;
  if (foldUpTo <= convo.summarizedCount) return; // nothing new has fallen out of the window
  const newlyOlder = messages.slice(convo.summarizedCount, foldUpTo);
  if (newlyOlder.length === 0) return;

  const transcript = newlyOlder
    .map((m) => `${m.role === 'user' ? 'User' : m.role === 'agent' ? 'Agent' : 'System'}: ${clip(m.content, 1500)}`)
    .join('\n');

  const system = [
    'You maintain a running summary of an ongoing conversation between a user and an AI agent.',
    `Merge the existing summary with the new older messages into ONE updated summary under ${MAX_SUMMARY_CHARS} characters.`,
    'Keep durable, useful context: what the user wants, decisions made, key facts, and open threads.',
    'Drop pleasantries and redundant detail. Write tight third-person notes. Return ONLY the summary text.',
  ].join('\n');
  const user = [
    `Existing summary:\n${convo.summary?.trim() || '(none yet)'}`,
    `New older messages to fold in:\n${transcript}`,
  ].join('\n\n');

  let summary: string;
  try {
    const llm = await openRouterChatCompletion(
      {
        model: normalizeQlixInferenceModelId(MEMORY_MODEL),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 700,
        stream: false,
      },
      { timeoutMs: 20_000, retries: 1 },
    );
    summary = clip(llm.content, MAX_SUMMARY_CHARS);
  } catch (err) {
    console.error('[agent-memory] summary update failed', err instanceof Error ? err.message : err);
    return;
  }
  if (!summary) return;

  try {
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { summary, summarizedCount: foldUpTo },
    });
  } catch (err) {
    console.error('[agent-memory] summary store failed', err instanceof Error ? err.message : err);
  }
}

interface ExtractionResult {
  facts?: unknown;
  episode?: unknown;
  recipe?: unknown;
}

/**
 * After a run finishes, ask a cheap model what is worth remembering and store it.
 * Fire-and-forget: never throws into the caller; a failure here must not affect the run.
 * Only learns from successful runs (failures aren't reliable signal).
 */
export async function extractAndStoreMemories(input: {
  agentId: string;
  userId: string;
  orgId: string | null;
  prompt: string;
  resultContent: string;
  ok: boolean;
  skills: string[];
}): Promise<void> {
  if (!input.ok) return;
  const task = clip(input.prompt ?? '', 2000);
  const result = clip(input.resultContent ?? '', 4000);
  if (!task || !result) return;

  const system = [
    'You extract long-term memory from one agent task exchange.',
    'Return STRICT JSON only (no prose, no code fences) shaped exactly as:',
    '{"facts": string[], "episode": string, "recipe": string | null}',
    '- facts: durable, reusable things about the USER or their world worth recalling in future tasks',
    '  (preferences, names, company, recurring needs). Skip one-off trivia. Use [] if none.',
    '- episode: one short sentence summarizing what was asked and how it turned out.',
    '- recipe: if a clear repeatable approach/tools made this succeed, one short "for tasks like X, do Y" note; otherwise null.',
    'Keep every item under 200 characters. Never invent anything not supported by the exchange.',
  ].join('\n');

  const user = [
    `Task: ${task}`,
    input.skills.length > 0 ? `Tools/skills used: ${input.skills.join(', ')}` : 'Tools/skills used: (none)',
    `Result: ${result}`,
  ].join('\n\n');

  let parsed: ExtractionResult;
  try {
    const llm = await openRouterChatCompletion(
      {
        model: normalizeQlixInferenceModelId(MEMORY_MODEL),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 500,
        stream: false,
      },
      { timeoutMs: 20_000, retries: 1 },
    );
    parsed = JSON.parse(stripJsonFence(llm.content)) as ExtractionResult;
  } catch (err) {
    console.error('[agent-memory] extraction failed', err instanceof Error ? err.message : err);
    return;
  }

  const rows: Array<{ kind: string; content: string }> = [];
  if (Array.isArray(parsed.facts)) {
    for (const fact of parsed.facts) {
      if (typeof fact === 'string' && fact.trim()) rows.push({ kind: 'fact', content: clip(fact, 300) });
    }
  }
  if (typeof parsed.episode === 'string' && parsed.episode.trim()) {
    rows.push({ kind: 'episode', content: clip(parsed.episode, 300) });
  }
  if (typeof parsed.recipe === 'string' && parsed.recipe.trim()) {
    rows.push({ kind: 'recipe', content: clip(parsed.recipe, 400) });
  }
  if (rows.length === 0) return;

  // Light de-dup: don't re-store a fact/recipe whose exact text we already hold for this user.
  const existing = await prisma.agentMemory.findMany({
    where: { agentId: input.agentId, userId: input.userId, kind: { in: ['fact', 'recipe'] } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { content: true },
  });
  const seen = new Set(existing.map((e) => e.content.trim().toLowerCase()));
  const toInsert = rows.filter(
    (r) => r.kind === 'episode' || !seen.has(r.content.trim().toLowerCase()),
  );
  if (toInsert.length === 0) return;

  try {
    await prisma.agentMemory.createMany({
      data: toInsert.map((r) => ({
        agentId: input.agentId,
        userId: input.userId,
        orgId: input.orgId,
        kind: r.kind,
        content: r.content,
        source: 'auto',
      })),
    });
  } catch (err) {
    console.error('[agent-memory] store failed', err instanceof Error ? err.message : err);
  }
}
