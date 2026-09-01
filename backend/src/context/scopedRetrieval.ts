import { estimateContextTokens } from './contextContracts.js';

export const RETRIEVAL_SOURCES = ['brain', 'context_object'] as const;
export type RetrievalSource = (typeof RETRIEVAL_SOURCES)[number];

export const DEFAULT_RETRIEVAL_MIN_SCORE = 0.2;
export const DEFAULT_RETRIEVAL_MAX_ITEMS = 6;
export const DEFAULT_RETRIEVAL_MAX_TOKENS = 800;
export const RETRIEVAL_EXCERPT_CHARS = 480;

export interface RetrievalQuery {
  orgId: string;
  agentId: string;
  grantedScopes: readonly string[];
  allowedSources: readonly string[];
  task: string;
  collectionIds?: readonly string[];
  updatedAfter?: Date | null;
  minScore: number;
  maxItems: number;
  maxTokens: number;
}

export interface RetrievalCandidate {
  source: RetrievalSource;
  id: string;
  orgId: string;
  allowedAgentIds: readonly string[];
  readScopes?: readonly string[];
  collectionId?: string | null;
  updatedAt?: Date | null;
  title: string;
  text: string;
  score: number;
  ref?: string;
}

export interface RetrievalHit {
  source: RetrievalSource;
  id: string;
  title: string;
  excerpt: string;
  score: number;
  tokens: number;
  ref?: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'with', 'this', 'from', 'your', 'have', 'what',
  'are', 'was', 'were', 'will', 'can', 'how', 'why', 'who', 'not', 'but',
]);

export function normalizeRetrievalQuery(
  input: Partial<RetrievalQuery> & Pick<RetrievalQuery, 'orgId' | 'agentId' | 'task'>,
): RetrievalQuery {
  const sources = (input.allowedSources ?? [...RETRIEVAL_SOURCES])
    .map((source) => source.trim())
    .filter((source): source is RetrievalSource => (
      source === 'brain' || source === 'context_object'
    ));
  return {
    orgId: input.orgId,
    agentId: input.agentId,
    grantedScopes: input.grantedScopes ?? [],
    allowedSources: sources.length > 0 ? sources : [...RETRIEVAL_SOURCES],
    task: input.task.trim(),
    collectionIds: input.collectionIds?.filter(Boolean),
    updatedAfter: input.updatedAfter ?? null,
    minScore: Math.min(1, Math.max(0, input.minScore ?? DEFAULT_RETRIEVAL_MIN_SCORE)),
    maxItems: Math.max(1, Math.min(12, input.maxItems ?? DEFAULT_RETRIEVAL_MAX_ITEMS)),
    maxTokens: Math.max(80, input.maxTokens ?? DEFAULT_RETRIEVAL_MAX_TOKENS),
  };
}

export function lexicalOverlapScore(task: string, text: string): number {
  const terms = tokenize(task);
  if (terms.length === 0) return 0;
  const haystack = ` ${text.toLowerCase()} `;
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(` ${term} `) || haystack.includes(term)) hits += 1;
  }
  return hits / terms.length;
}

export function candidateInDeterministicScope(
  candidate: RetrievalCandidate,
  query: RetrievalQuery,
): boolean {
  if (candidate.orgId !== query.orgId) return false;
  if (!query.allowedSources.includes(candidate.source)) return false;
  if (candidate.allowedAgentIds.length > 0 && !candidate.allowedAgentIds.includes(query.agentId)) {
    return false;
  }
  if (candidate.readScopes?.some((scope) => !query.grantedScopes.includes(scope))) return false;
  if (candidate.source === 'brain' && !query.grantedScopes.includes('brain.query')) return false;
  if (query.collectionIds && query.collectionIds.length > 0) {
    if (!candidate.collectionId || !query.collectionIds.includes(candidate.collectionId)) return false;
  }
  if (query.updatedAfter && candidate.updatedAt && candidate.updatedAt.getTime() < query.updatedAfter.getTime()) {
    return false;
  }
  return true;
}

/** Rank only after ACL / source / time filters. Scores below the threshold never enter the pack. */
export function rankRetrievalHits(
  candidates: readonly RetrievalCandidate[],
  query: RetrievalQuery,
): { hits: RetrievalHit[]; droppedBelowThreshold: number; outOfScope: number } {
  let outOfScope = 0;
  let droppedBelowThreshold = 0;
  const inScope: RetrievalCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidateInDeterministicScope(candidate, query)) {
      outOfScope += 1;
      continue;
    }
    if (candidate.score < query.minScore) {
      droppedBelowThreshold += 1;
      continue;
    }
    inScope.push(candidate);
  }
  inScope.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const hits: RetrievalHit[] = [];
  let tokensUsed = 0;
  for (const candidate of inScope) {
    if (hits.length >= query.maxItems) break;
    const excerpt = compactExcerpt(candidate.text, RETRIEVAL_EXCERPT_CHARS);
    const tokens = estimateContextTokens(excerpt);
    if (tokensUsed + tokens > query.maxTokens) break;
    hits.push({
      source: candidate.source,
      id: candidate.id,
      title: candidate.title,
      excerpt,
      score: candidate.score,
      tokens,
      ref: candidate.ref,
    });
    tokensUsed += tokens;
  }
  return { hits, droppedBelowThreshold, outOfScope };
}

export function formatRetrievalHitsForPack(hits: readonly RetrievalHit[]): string {
  if (hits.length === 0) return '';
  return hits.map((hit, index) => {
    const handle = hit.ref ? ` ${hit.ref}` : '';
    return `[${index + 1}] ${hit.source}:${hit.title}${handle}\n${hit.excerpt}`;
  }).join('\n\n---\n\n');
}

function compactExcerpt(text: string, maxChars: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).replace(/\s+\S*$/, '').trim()}…`;
}

function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
  }
  return terms;
}
