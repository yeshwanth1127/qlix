import type { Request } from 'express';
import { prisma } from './prisma.js';
import { verifyAgentCreateStepUpToken } from './authTokens.js';
import { loadJwtSecret } from '../middleware/authenticateUser.js';

/** Guests can try the platform with a few agents before claiming their account. */
export const GUEST_MAX_AGENTS = 3;

export type StepUpCheck =
  | { ok: true; isGuest: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * Device step-up (WebAuthn) gate for creation endpoints. Guest accounts have no
 * passkey by design, so the step-up requirement is waived for them — their blast
 * radius is bounded by the guest agent cap and an empty wallet.
 */
export async function checkStepUpOrGuest(request: Request): Promise<StepUpCheck> {
  const userId = request.auth!.userId;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isGuest: true },
  });
  if (!user) {
    return { ok: false, status: 401, code: 'unauthorized', message: 'Account not found' };
  }
  if (user.isGuest) {
    return { ok: true, isGuest: true };
  }

  const stepUpHeader = request.headers['x-qlix-device-step-up'];
  const stepUpToken = typeof stepUpHeader === 'string' ? stepUpHeader.trim() : '';
  if (!stepUpToken) {
    return {
      ok: false,
      status: 403,
      code: 'step_up_required',
      message: 'Complete device verification (WebAuthn) immediately before creating an agent',
    };
  }
  try {
    verifyAgentCreateStepUpToken(stepUpToken, loadJwtSecret(), userId);
  } catch {
    return {
      ok: false,
      status: 403,
      code: 'step_up_invalid_or_expired',
      message: 'Device step-up token is missing, invalid, or expired; verify again',
    };
  }
  return { ok: true, isGuest: false };
}

/** Returns an error payload when a guest is at their agent cap, else null. */
export async function checkGuestAgentCap(
  userId: string,
  agentsToCreate: number,
): Promise<{ status: number; code: string; message: string } | null> {
  const count = await prisma.agent.count({ where: { userId } });
  if (count + agentsToCreate > GUEST_MAX_AGENTS) {
    return {
      status: 403,
      code: 'guest_agent_limit',
      message: `Guest accounts can create up to ${GUEST_MAX_AGENTS} agents — create a free account to keep going`,
    };
  }
  return null;
}
