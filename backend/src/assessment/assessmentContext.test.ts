import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNormalizedAssessmentContext, type AssessmentContextBase } from './assessmentContext.js';

const base: AssessmentContextBase = {
  session: {
    id: 'session-1', teamId: 'team-1', recipeId: 'recipe', status: 'submitted',
    projectDescription: 'Build an app', expectedStack: ['TypeScript'], aiUsagePolicy: null,
    checklist: [], requiredDeliverables: [], startedAt: new Date('2026-01-01T00:00:00Z'), submittedAt: null,
  },
  framework: {
    id: 'framework-1', name: 'Framework', version: 1, integrityPolicy: {},
    criteria: [
      { criterion_id: 'process-1', category: 'process', text: 'Process' },
      { criterion_id: 'security-1', category: 'security', text: 'Security' },
    ],
  },
  evidence: [
    { id: 'git-1', kind: 'git_event', source: 'test', occurredAt: new Date('2026-01-01T01:00:00Z'), payload: { hash: 'a' }, redacted: false, contentRef: null },
    { id: 'secret-1', kind: 'ai_prompt', source: 'test', occurredAt: new Date('2026-01-01T02:00:00Z'), payload: { prompt: 'x' }, redacted: false, contentRef: null },
  ],
  snapshots: [],
};

test('assessment adapter scopes one generic context pack by role', () => {
  const pack = buildNormalizedAssessmentContext({ role: 'process_integrity', base, record: null });
  assert.deepEqual(pack.framework.criteria, [{ criterion_id: 'process-1', category: 'process', text: 'Process' }]);
  assert.deepEqual(pack.evidence.map((item) => item.id), ['git-1']);
  assert.match(pack.contextRef, /^assessment-context:sha256:/);
});

test('reporter receives shared structured findings without raw evidence', () => {
  const pack = buildNormalizedAssessmentContext({
    role: 'reporter',
    base,
    record: {
      id: 'record-1', createdAt: new Date('2026-01-01T03:00:00Z'), reviewTranscript: [],
      findings: [{ criterion_id: 'process-1', evidence_refs: ['git-1'] }],
    },
  });
  assert.equal(pack.sharedState.assessmentRecordId, 'record-1');
  assert.equal(pack.sharedState.findings.length, 1);
  assert.deepEqual(pack.evidence, []);
});

