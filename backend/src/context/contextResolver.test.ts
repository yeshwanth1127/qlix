import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  extractContextRefs,
  parseContextPack,
  CONTEXT_PACK_CONTRACT_VERSION,
  estimateContextTokens,
} from './contextContracts.js';
import { compileContextPack, contextPackComponentTokens } from './contextResolver.js';

const fixtureUrl = new URL('../../../contracts/context-plane/fixtures/context-pack.v1.json', import.meta.url);

test('shared context pack fixture is valid', () => {
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;
  const parsed = parseContextPack(fixture);
  assert.equal(parsed.contractVersion, CONTEXT_PACK_CONTRACT_VERSION);
  assert.equal(parsed.references[0]?.ref.startsWith('ctx:'), true);
});

test('resolver inlines task and memory under budget and omits transcript/brain', async () => {
  const pack = await compileContextPack({
    runId: 'run_1',
    goal: 'Continue the document',
    taskText: 'Please send the brochure again.',
    memoryText: 'Requirements: keep current agent capabilities.\nArtifacts: https://example.com/doc/1',
  });
  assert.equal(pack.inline.some((item) => item.component === 'task'), true);
  assert.equal(pack.inline.some((item) => item.component === 'memory'), true);
  assert.equal(pack.references.length, 0);
  assert.ok(pack.omitted.some((item) => item.component === 'full_transcript'));
  assert.ok(pack.omitted.some((item) => item.component === 'brain'));
  const tokens = contextPackComponentTokens(pack);
  assert.equal(tokens.task, estimateContextTokens('Please send the brochure again.'));
});

test('resolver extracts ctx refs from a Team dispatch prompt', async () => {
  const ref = 'ctx:cm123abc0000:v1:aaaaaaaaaaaa';
  const pack = await compileContextPack({
    runId: 'run_team',
    goal: 'Use the prior Result',
    taskText: `Dispatch: summarize ${ref}`,
    memoryText: null,
  });
  assert.deepEqual(pack.references.map((item) => item.ref), [ref]);
  assert.equal(pack.inline.find((item) => item.component === 'task')?.text.includes(ref), true);
});

test('extractContextRefs is case-preserving on unique refs', () => {
  const refs = extractContextRefs('see ctx:abc1:v1:bbbbbbbbbbbb and ctx:abc1:v1:bbbbbbbbbbbb');
  assert.deepEqual(refs, ['ctx:abc1:v1:bbbbbbbbbbbb']);
});

test('resolver inlines owned Brain under the agent context budget', async () => {
  const pack = await compileContextPack({
    runId: 'run_brain',
    goal: 'What is the travel policy?',
    taskText: 'What is the travel policy?',
    memoryText: null,
    brainOwned: true,
    brainText: 'Org Brain: receipts over $50 need a manager signature.',
    brainCitations: [{ documentTitle: 'Travel policy', chunkOrdinal: 0 }],
  });
  const brain = pack.inline.find((item) => item.component === 'brain');
  assert.ok(brain);
  assert.match(brain!.text, /receipts over \$50/);
  assert.equal(pack.omitted.some((item) => item.component === 'brain'), false);
  assert.deepEqual((brain!.data as { citations: unknown }).citations, [
    { documentTitle: 'Travel policy', chunkOrdinal: 0 },
  ]);
});

test('resolver owns an empty Brain retrieval so the runner does not fetch again', async () => {
  const pack = await compileContextPack({
    runId: 'run_brain_empty',
    goal: 'Ask the knowledge base',
    taskText: 'Ask the knowledge base',
    brainOwned: true,
    brainText: '',
  });
  assert.ok(pack.omitted.some((item) => item.component === 'brain' && item.reason === 'owned_empty'));
  assert.equal(pack.inline.some((item) => item.component === 'brain'), false);
});
