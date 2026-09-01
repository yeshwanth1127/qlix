import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLunaTeamsResult, TOOL_EVIDENCE_RESULT_CONTRACT } from '../teams/lunaTeamsHost.js';
import type { TeamRunDTO } from '../teams/teams.types.js';
import { assertAssessmentProvenanceRecords } from './assessmentProvenance.js';
import { POOJA_EIGHT_ARTIFACTS_FIXTURE } from './fixtures/poojaEightArtifacts.fixture.js';

test('Pooja regression accepts all eight database-backed artifact uploads', () => {
  const fixture = POOJA_EIGHT_ARTIFACTS_FIXTURE;
  const run = {
    id: 'team-run-pooja',
    orgId: fixture.orgId,
    goal: `Assess Work Session ${fixture.sessionId}`,
    inputs: [],
  } as unknown as TeamRunDTO;
  const result = validateLunaTeamsResult({
    run,
    dispatch: {
      inputRefs: [],
      allowedSources: ['authoritative_input'],
      knowledgeMode: 'none',
      outputContract: TOOL_EVIDENCE_RESULT_CONTRACT,
      resultPolicy: 'tool_evidence.v1',
    },
    executedToolRefs: ['assessment_evidence_search', 'assessment_artifact_read'],
    payload: {
      summary: 'Reviewed all eight uploads',
      findings: { artifactCount: 8 },
      provenance: {
        toolRefs: ['assessment_evidence_search', 'assessment_artifact_read'],
        evidenceRefs: fixture.artifactIds,
        artifactRefs: fixture.artifactIds,
      },
    },
  });
  assert.equal(result.provenance.artifactRefs.length, 8);
  assertAssessmentProvenanceRecords({
    runGoal: run.goal,
    provenance: result.provenance,
    records: fixture.artifactIds.map((id) => ({
      id,
      kind: 'artifact_upload',
      sessionId: fixture.sessionId,
    })),
  });
});

test('Pooja regression rejects an artifact id from another Work Session', () => {
  const fixture = POOJA_EIGHT_ARTIFACTS_FIXTURE;
  assert.throws(() => assertAssessmentProvenanceRecords({
    runGoal: `Assess Work Session ${fixture.sessionId}`,
    provenance: { evidenceRefs: [fixture.artifactIds[0]], artifactRefs: [fixture.artifactIds[0]] },
    records: [{ id: fixture.artifactIds[0], kind: 'artifact_upload', sessionId: 'different-session' }],
  }), /does not belong to the Work Session/);
});
