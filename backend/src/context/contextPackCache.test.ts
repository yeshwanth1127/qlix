import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrainContextLoad } from './brainContextAdapter.js';
import {
  clearContextPackCache,
  contextPackCacheKey,
  getOrCompileCachedContextPack,
} from './contextPackCache.js';

function failedBrain(): BrainContextLoad {
  return { text: '', citations: [], empty: true, failed: true };
}

function loadedBrain(text: string): BrainContextLoad {
  return {
    text,
    citations: [{
      collectionId: 'col_1',
      collectionName: 'Policies',
      documentId: 'doc_1',
      documentTitle: 'Policy',
      chunkOrdinal: 0,
      excerpt: text,
    }],
    empty: false,
    failed: false,
  };
}

const baseSources = {
  runId: 'run_cache_1',
  orgId: 'org_1',
  agentId: 'agent_1',
  taskText: 'What is the travel policy?',
  memoryText: 'Keep receipts.',
  useBrain: true,
  brainSourceVersion: 'doc1:2026-08-28T00:00:00.000Z',
  permissionFingerprint: 'org_1:agent_1',
};

test('pack cache skips Brain reload for the same request, sources, and permissions', async () => {
  clearContextPackCache();
  let loads = 0;
  const loadBrain = async () => {
    loads += 1;
    return loadedBrain('Org Brain: receipts over $50 need a manager signature.');
  };
  const compile = {
    orgId: baseSources.orgId,
    agentId: baseSources.agentId,
    runId: baseSources.runId,
    goal: baseSources.taskText,
    taskText: baseSources.taskText,
    memoryText: baseSources.memoryText,
    sources: ['run.brain'] as string[],
  };
  const first = await getOrCompileCachedContextPack({ sources: baseSources, compile, loadBrain });
  const second = await getOrCompileCachedContextPack({ sources: baseSources, compile, loadBrain });
  assert.equal(first.cacheHit, false);
  assert.equal(first.brainLoaded, true);
  assert.equal(second.cacheHit, true);
  assert.equal(second.brainLoaded, false);
  assert.equal(loads, 1);
  assert.equal(second.pack.packId, first.pack.packId);
  assert.ok(second.pack.inline.some((item) => item.component === 'brain'));
});

test('pack cache misses when memory, Brain source version, or agent permissions change', async () => {
  clearContextPackCache();
  const loadBrain = async () => loadedBrain('Org Brain: receipts over $50.');
  const compile = {
    orgId: baseSources.orgId,
    agentId: baseSources.agentId,
    runId: baseSources.runId,
    goal: baseSources.taskText,
    taskText: baseSources.taskText,
    memoryText: baseSources.memoryText,
    sources: ['run.brain'] as string[],
  };
  await getOrCompileCachedContextPack({ sources: baseSources, compile, loadBrain });

  const memoryMiss = await getOrCompileCachedContextPack({
    sources: { ...baseSources, memoryText: 'Updated memory' },
    compile: { ...compile, memoryText: 'Updated memory' },
    loadBrain,
  });
  const versionMiss = await getOrCompileCachedContextPack({
    sources: { ...baseSources, brainSourceVersion: 'doc2:2026-08-28T01:00:00.000Z' },
    compile,
    loadBrain,
  });
  const permissionMiss = await getOrCompileCachedContextPack({
    sources: {
      ...baseSources,
      agentId: 'agent_2',
      permissionFingerprint: 'org_1:agent_2',
    },
    compile: { ...compile, agentId: 'agent_2' },
    loadBrain,
  });
  assert.equal(memoryMiss.cacheHit, false);
  assert.equal(versionMiss.cacheHit, false);
  assert.equal(permissionMiss.cacheHit, false);
  assert.notEqual(
    contextPackCacheKey(baseSources),
    contextPackCacheKey({ ...baseSources, permissionFingerprint: 'org_1:agent_2' }),
  );
});

test('runner_fallback packs are not cached so the next poll can retry Brain', async () => {
  clearContextPackCache();
  let loads = 0;
  const loadBrain = async () => {
    loads += 1;
    return failedBrain();
  };
  const compile = {
    runId: 'run_fallback',
    goal: 'Ask Brain',
    taskText: 'Ask Brain',
    memoryText: null,
    sources: ['run.brain'] as string[],
  };
  const sources = {
    ...baseSources,
    runId: 'run_fallback',
    memoryText: null,
  };
  const first = await getOrCompileCachedContextPack({ sources, compile, loadBrain });
  const second = await getOrCompileCachedContextPack({ sources, compile, loadBrain });
  assert.ok(first.pack.omitted.some((item) => item.reason === 'runner_fallback'));
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, false);
  assert.equal(loads, 2);
});
