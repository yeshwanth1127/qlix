import { prisma } from '../lib/prisma.js';

export interface AssessmentEvidenceProvenance {
  evidenceRefs: string[];
  artifactRefs: string[];
}

export interface AssessmentEvidenceRecordRef {
  id: string;
  kind: string;
  sessionId: string;
}

export function assertAssessmentProvenanceRecords(params: {
  runGoal: string;
  provenance: AssessmentEvidenceProvenance;
  records: AssessmentEvidenceRecordRef[];
}): void {
  const refs = [...new Set([...params.provenance.evidenceRefs, ...params.provenance.artifactRefs])];
  const byId = new Map(params.records.map((record) => [record.id, record]));
  const missing = refs.filter((ref) => !byId.has(ref));
  if (missing.length > 0) {
    throw new Error(`Result cites unknown assessment evidence: ${missing.join(', ')}`);
  }
  const invalidArtifacts = params.provenance.artifactRefs.filter(
    (ref) => byId.get(ref)?.kind !== 'artifact_upload',
  );
  if (invalidArtifacts.length > 0) {
    throw new Error(`Result artifactRefs must cite artifact_upload evidence: ${invalidArtifacts.join(', ')}`);
  }
  const sessionIds = [...new Set(params.records.map((record) => record.sessionId))];
  if (sessionIds.length !== 1 || !params.runGoal.includes(sessionIds[0]!)) {
    throw new Error('Result evidence does not belong to the Work Session in this Team run');
  }
}

/** Verify model-cited assessment ids against the authoritative organization/session records. */
export async function verifyAssessmentResultProvenance(params: {
  orgId: string;
  runGoal: string;
  provenance: AssessmentEvidenceProvenance;
}): Promise<void> {
  const refs = [...new Set([...params.provenance.evidenceRefs, ...params.provenance.artifactRefs])];
  const records = await prisma.evidenceRecord.findMany({
    where: {
      id: { in: refs },
      session: { orgId: params.orgId },
    },
    select: { id: true, kind: true, sessionId: true },
  });
  assertAssessmentProvenanceRecords({
    runGoal: params.runGoal,
    provenance: params.provenance,
    records,
  });
}
