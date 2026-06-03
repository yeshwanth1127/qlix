import { randomBytes } from 'node:crypto';

export function generateDID(): string {
  // did:qlix:{16 random hex chars}
  const unique = randomBytes(8).toString('hex');
  return `did:qlix:${unique}`;
}
