import { createHash, randomBytes } from 'node:crypto';

export function hashInviteToken(plainToken: string): string {
  return createHash('sha256').update(plainToken, 'utf8').digest('hex');
}

/** Opaque token returned once to the inviter (MVP: no email). */
export function generateInvitePlainToken(): string {
  return `qlix_${randomBytes(24).toString('base64url')}`;
}
