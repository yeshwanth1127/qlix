import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidateInDeterministicScope,
  formatRetrievalHitsForPack,
  lexicalOverlapScore,
  normalizeRetrievalQuery,
  rankRetrievalHits,
  type RetrievalCandidate,
} from './scopedRetrieval.js';
import { compileContextPack } from './contextResolver.js';

function candidate(overrides: Partial<RetrievalCandidate> & Pick<RetrievalCandidate, 'id' | 'score' | 'text'>): RetrievalCandidate {
  return {
    source: 'brain',
    orgId: 'org_1',
    allowedAgentIds: [],
    title: 'Travel policy',
    collectionId: 'col_1',
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

const query = normalizeRetrievalQuery({
  orgId: 'org_1',
  agentId: 'agent_1',
  grantedScopes: ['brain.query'],
  task: 'travel receipts over fifty dollars',
  minScore: 0.2,
  maxItems: 3,
  maxTokens: 400,
});

test('deterministic filters drop other orgs, agents, collections, and missing Brain scope before ranking', () => {
  assert.equal(
    candidateInDeterministicScope(candidate({ id: 'a', score: 0.99, text: 'x', orgId: 'org_other' }), query),
    false,
  );
  assert.equal(
    candidateInDeterministicScope(
      candidate({ id: 'b', score: 0.99, text: 'x', allowedAgentIds: ['agent_other'] }),
      query,
    ),
    false,
  );
  assert.equal(
    candidateInDeterministicScope(
      candidate({ id: 'c', score: 0.99, text: 'x' }),
      { ...query, grantedScopes: [] },
    ),
    false,
  );
  assert.equal(
    candidateInDeterministicScope(
      candidate({ id: 'd', score: 0.99, text: 'x', collectionId: 'col_1' }),
      { ...query, collectionIds: ['col_1'] },
    ),
    true,
  );
  assert.equal(
    candidateInDeterministicScope(
      candidate({ id: 'e', score: 0.99, text: 'x', collectionId: 'col_hidden' }),
      { ...query, collectionIds: ['col_visible'] },
    ),
    false,
  );
});

test('semantic ranking never promotes an out-of-scope hit over an in-scope one', () => {
  const ranked = rankRetrievalHits([
    candidate({
      id: 'leaked',
      orgId: 'org_other',
      score: 0.99,
      text: 'travel receipts over fifty dollars must be signed',
    }),
    candidate({
      id: 'in_scope',
      score: 0.31,
      text: 'travel receipts over fifty dollars need a manager signature',
    }),
    candidate({
      id: 'noise',
      score: 0.05,
      text: 'travel receipts over fifty dollars cafeteria menu',
    }),
  ], query);
  assert.deepEqual(ranked.hits.map((hit) => hit.id), ['in_scope']);
  assert.equal(ranked.outOfScope, 1);
  assert.equal(ranked.droppedBelowThreshold, 1);
});

test('lexical overlap scores task terms after filters, not the other way around', () => {
  assert.ok(lexicalOverlapScore('travel receipts', 'Keep travel receipts over $50') > 0.5);
  assert.equal(lexicalOverlapScore('travel receipts', 'unrelated cafeteria menu'), 0);
});

test('resolver applies scoped retrieval only after task/memory and within the remaining budget', async () => {
  const pack = await compileContextPack({
    orgId: 'org_1',
    agentId: 'agent_1',
    runId: 'run_retrieval',
    goal: 'What is the travel policy?',
    taskText: 'What is the travel policy?',
    memoryText: null,
    grantedScopes: ['brain.query'],
    retrievalCandidates: [
      candidate({
        id: 'foreign',
        orgId: 'org_other',
        score: 0.99,
        text: 'Secret from another tenant about travel receipts.',
      }),
      candidate({
        id: 'keep',
        score: 0.8,
        text: 'Receipts over $50 need a manager signature.',
        ref: 'ctx:cmkeep000001:v1:aaaaaaaaaaaa',
      }),
    ],
  });
  const retrieval = pack.inline.find((item) => item.component === 'retrieval');
  assert.ok(retrieval);
  assert.match(retrieval!.text, /Receipts over \$50/);
  assert.equal(retrieval!.text.includes('Secret from another tenant'), false);
  assert.ok(pack.references.some((item) => item.ref === 'ctx:cmkeep000001:v1:aaaaaaaaaaaa'));
  assert.equal(formatRetrievalHitsForPack(rankRetrievalHits([], query).hits), '');
});
