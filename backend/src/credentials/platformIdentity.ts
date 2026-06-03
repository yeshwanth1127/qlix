import * as ed from '@noble/ed25519';

/**
 * Platform-level signing identity used to sign every Verifiable Credential
 * Qlix issues to agents. The DID is published at `/.well-known/did.json` so
 * external verifiers can fetch the public key offline.
 *
 * Requires `QLIX_PLATFORM_DID` and `QLIX_PLATFORM_PRIVATE_KEY` (validated at
 * process startup in `loadEnvironmentConfig`).
 */
export interface PlatformIdentity {
  did: string;
  privateKeyHex: string;
  publicKeyHex: string;
}

let cached: PlatformIdentity | null = null;

async function derivePublicKeyHex(privateKeyHex: string): Promise<string> {
  const secret = Buffer.from(privateKeyHex, 'hex');
  if (secret.byteLength !== 32) {
    throw new Error('QLIX_PLATFORM_PRIVATE_KEY must be 32 bytes (64 hex chars)');
  }
  const publicKey = await ed.getPublicKeyAsync(secret);
  return Buffer.from(publicKey).toString('hex');
}

export async function getPlatformIdentity(): Promise<PlatformIdentity> {
  if (cached) return cached;

  const envDid = process.env.QLIX_PLATFORM_DID?.trim();
  const envPriv = process.env.QLIX_PLATFORM_PRIVATE_KEY?.trim();

  if (!envDid || !envPriv) {
    throw new Error('QLIX_PLATFORM_DID and QLIX_PLATFORM_PRIVATE_KEY must be set');
  }

  cached = {
    did: envDid,
    privateKeyHex: envPriv,
    publicKeyHex: await derivePublicKeyHex(envPriv),
  };
  return cached;
}
