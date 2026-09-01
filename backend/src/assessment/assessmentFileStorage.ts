import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Durable local storage for large assessment evidence content (currently: the
 * final source-code archive), mirrors backend/src/aiBrain/brainFileStorage.ts.
 * Unlike sandboxClient.ts (ephemeral generated deliverables with a TTL), this
 * has no expiry — evidence needs to persist for later human/agent review.
 */

function assessmentFilesRoot(): string {
  const fromEnv = process.env.QLIX_ASSESSMENT_FILES_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), 'data', 'assessment-files');
}

function safeLabel(label: string): string {
  return (label || 'snapshot').replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'snapshot';
}

/** Stores bytes under {orgId}/{sessionId}/{label}.zip and returns the relative
 * storage key to save as ProjectSnapshot.contentRef. */
export async function storeAssessmentArchive(input: {
  orgId: string;
  sessionId: string;
  label: string;
  bytes: Buffer;
}): Promise<{ storageKey: string; sizeBytes: number }> {
  const fileName = `${safeLabel(input.label)}.zip`;
  const storageKey = join(input.orgId, input.sessionId, fileName);
  const dir = join(assessmentFilesRoot(), input.orgId, input.sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), input.bytes);
  return { storageKey, sizeBytes: input.bytes.length };
}
