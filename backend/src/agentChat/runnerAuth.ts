import crypto from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { decryptForAgentSecrets } from '../cloudRunners/agentSecrets.js';

export const RUNNER_TOKEN_HEADER = 'x-qlix-runner-token';

export class RunnerUnauthorizedError extends Error {
  constructor(message = 'Runner unauthorized') {
    super(message);
  }
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Compute HMAC-SHA256 of a runner token using the AGENT_SECRETS_KEY env var as the key.
 * Used for hybrid runner token storage (one-way, no decryption needed).
 */
function computeHybridTokenHash(token: string): string {
  const key = process.env.AGENT_SECRETS_KEY ?? 'qlix-dev-secret';
  return crypto.createHmac('sha256', key).update(token).digest('hex');
}

/** Runner token from `X-QLIX-Runner-Token` or `Authorization: Bearer` (OpenAI client / Agent-S3). */
export function extractRunnerToken(request: { headers: Record<string, unknown> }): string {
  const raw =
    request.headers[RUNNER_TOKEN_HEADER] ?? request.headers[RUNNER_TOKEN_HEADER.toLowerCase()];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();

  const auth = request.headers.authorization ?? request.headers.Authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

export async function assertRunnerAuth(agentId: string, request: { headers: Record<string, unknown> }): Promise<void> {
  const token = extractRunnerToken(request);
  if (!token) throw new RunnerUnauthorizedError('Missing runner token');

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { cloudRunnerTokenEnc: true, runtime: true, ..._hybridSelect },
  });
  if (!agent) throw new RunnerUnauthorizedError('Unknown agent');

  if (agent.runtime === 'cloud') {
    if (!agent.cloudRunnerTokenEnc) throw new RunnerUnauthorizedError('Runner token not configured');
    const expected = decryptForAgentSecrets(agent.cloudRunnerTokenEnc);
    if (!timingSafeEqualStr(expected, token)) throw new RunnerUnauthorizedError('Runner token mismatch');
    return;
  }

  if (agent.runtime === 'hybrid') {
    const stored = (agent as any).hybridRunnerTokenHash as string | null;
    if (!stored) throw new RunnerUnauthorizedError('Runner token not configured');
    const computed = computeHybridTokenHash(token);
    if (!timingSafeEqualStr(computed, stored)) throw new RunnerUnauthorizedError('Runner token mismatch');
    return;
  }

  throw new RunnerUnauthorizedError('Unknown agent');
}

/** Ping URL may use agent DID (cloud) or agent id (legacy hybrid starter packs). */
export async function assertRunnerAuthByDidOrId(
  didOrAgentId: string,
  request: { headers: Record<string, unknown> },
): Promise<void> {
  const key = didOrAgentId.trim();
  if (key.startsWith('did:')) {
    await assertRunnerAuthByDid(key, request);
    return;
  }
  await assertRunnerAuth(key, request);
}

export async function assertRunnerAuthByDid(did: string, request: { headers: Record<string, unknown> }): Promise<void> {
  const token = extractRunnerToken(request);
  if (!token) throw new RunnerUnauthorizedError('Missing runner token');

  const agent = await prisma.agent.findUnique({
    where: { did },
    select: { cloudRunnerTokenEnc: true, runtime: true, ..._hybridSelect },
  });
  if (!agent) throw new RunnerUnauthorizedError('Unknown agent');

  if (agent.runtime === 'cloud') {
    if (!agent.cloudRunnerTokenEnc) throw new RunnerUnauthorizedError('Runner token not configured');
    const expected = decryptForAgentSecrets(agent.cloudRunnerTokenEnc);
    if (!timingSafeEqualStr(expected, token)) throw new RunnerUnauthorizedError('Runner token mismatch');
    return;
  }

  if (agent.runtime === 'hybrid') {
    const stored = (agent as any).hybridRunnerTokenHash as string | null;
    if (!stored) throw new RunnerUnauthorizedError('Runner token not configured');
    const computed = computeHybridTokenHash(token);
    if (!timingSafeEqualStr(computed, stored)) throw new RunnerUnauthorizedError('Runner token mismatch');
    return;
  }

  throw new RunnerUnauthorizedError('Unknown agent');
}

/**
 * Generate a cryptographically random runner token (64 hex chars) and its HMAC hash.
 * Use at hybrid agent creation time; store only the hash, return the plaintext to the user once.
 */
export function generateHybridRunnerToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = computeHybridTokenHash(token);
  return { token, hash };
}

// Prisma select fragment for hybrid fields (avoids TS unknown field errors at call sites).
const _hybridSelect = { hybridRunnerTokenHash: true } as const;
