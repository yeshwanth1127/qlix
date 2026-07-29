import type { Request } from 'express';
import { prisma } from './prisma.js';

/** Guests can try the platform with a few agents before claiming their account. */
export const GUEST_MAX_AGENTS = 3;

export type StepUpCheck =
  | { ok: true; isGuest: boolean }
  | { ok: false; status: number; code: string; message: string };

/**
 * Gate for creation endpoints. Authenticated browser session is sufficient —
 * WebAuthn / passkey step-up is not required. Guests remain capped separately.
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
  return { ok: true, isGuest: user.isGuest };
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
