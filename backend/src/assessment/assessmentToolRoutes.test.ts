import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSESSMENT_EVIDENCE_KINDS,
  mergeAssessmentFindings,
  normalizeAssessmentEvidenceKind,
  parseAssessmentRecordBody,
} from './assessmentToolRoutes.js';

test('assessment evidence kinds preserve every canonical filter', () => {
  for (const kind of ASSESSMENT_EVIDENCE_KINDS) {
    assert.equal(normalizeAssessmentEvidenceKind(kind), kind);
  }
});

test('artifact aliases resolve to artifact_upload', () => {
  for (const alias of ['artifact', 'artifacts', 'upload', 'uploads', 'artifact-upload']) {
    assert.equal(normalizeAssessmentEvidenceKind(alias), 'artifact_upload');
  }
});

test('unknown evidence kinds fail closed', () => {
  assert.equal(normalizeAssessmentEvidenceKind('artifact_record'), undefined);
});

test('batch findings replace the same agent criterion and preserve other owners', () => {
  const merged = mergeAssessmentFindings(
    [
      { evaluator_agent_id: 'agent-a', criterion_id: 'c1', verdict: 'unclear' },
      { evaluator_agent_id: 'agent-b', criterion_id: 'c1', verdict: 'met' },
      { evaluator_agent_id: 'agent-a', criterion_id: 'c2', verdict: 'met' },
    ],
    [
      { evaluator_agent_id: 'agent-a', criterion_id: 'c1', verdict: 'not_met' },
      { evaluator_agent_id: 'agent-a', criterion_id: 'c3', verdict: 'partially_met' },
      { evaluator_agent_id: 'agent-a', criterion_id: 'c3', verdict: 'met' },
    ],
  );

  assert.deepEqual(merged, [
    { evaluator_agent_id: 'agent-b', criterion_id: 'c1', verdict: 'met' },
    { evaluator_agent_id: 'agent-a', criterion_id: 'c2', verdict: 'met' },
    { evaluator_agent_id: 'agent-a', criterion_id: 'c1', verdict: 'not_met' },
    { evaluator_agent_id: 'agent-a', criterion_id: 'c3', verdict: 'met' },
  ]);
});

test('assessment records reject findings without evidence references', () => {
  const base = {
    runId: 'run-1',
    sessionId: 'session-1',
    findings: [{
      criterionId: 'criterion-1',
      verdict: 'needs_review',
      confidence: 0.5,
      rationale: 'The available record is inconclusive.',
    }],
  };
  assert.equal(parseAssessmentRecordBody(base).success, false);
  assert.equal(parseAssessmentRecordBody({
    ...base,
    findings: [{ ...base.findings[0], evidenceRefs: [] }],
  }).success, false);
  assert.equal(parseAssessmentRecordBody({
    ...base,
    findings: [{ ...base.findings[0], evidenceRefs: ['evidence-1'] }],
  }).success, true);
});
