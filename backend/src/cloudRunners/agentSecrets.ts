import crypto from 'node:crypto';

export class AgentSecretsKeyMissingError extends Error {
  constructor() {
    super('AGENT_SECRETS_KEY is required to provision cloud agents');
  }
}

function loadSecretsKey(): Buffer {
  const raw = process.env.AGENT_SECRETS_KEY?.trim();
  if (!raw) throw new AgentSecretsKeyMissingError();
  // Accept either 64 hex chars (32 bytes) or base64 (32 bytes).
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('AGENT_SECRETS_KEY must be 32 bytes (64 hex chars or base64 for 32 bytes)');
  }
  return buf;
}

/**
 * Encrypts sensitive agent material for DB storage (AES-256-GCM).
 * Format: `v1:<iv_b64>:<ciphertext_b64>:<tag_b64>`
 */
export function encryptForAgentSecrets(plaintextUtf8: string): string {
  const key = loadSecretsKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextUtf8, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

export function decryptForAgentSecrets(encrypted: string): string {
  const key = loadSecretsKey();
  const parts = encrypted.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted agent secret format');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');
  const tag = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

