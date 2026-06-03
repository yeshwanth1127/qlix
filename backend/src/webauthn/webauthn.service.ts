import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type GenerateRegistrationOptionsOpts,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { WebAuthnEnvironment } from '../config/loadEnvironmentConfig.js';
import { isDeviceVerificationComplete } from '../deviceVerification/deviceVerification.js';
import { prisma } from '../lib/prisma.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

type ChallengeEntry = { challenge: string; expiresAt: number };

/** In-memory registration challenges; replace with Redis for multi-instance deployments. */
const registrationChallengeStore = new Map<string, ChallengeEntry>();

/** In-memory authentication (assertion) challenges. */
const authenticationChallengeStore = new Map<string, ChallengeEntry>();

function pruneStore(store: Map<string, ChallengeEntry>): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export class WebAuthnService {
  constructor(private readonly config: WebAuthnEnvironment) {}

  async generateRegistrationOptions(userId: string): Promise<Awaited<ReturnType<typeof generateRegistrationOptions>>> {
    pruneStore(registrationChallengeStore);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const userIdBytes = new TextEncoder().encode(userId);
    if (userIdBytes.byteLength > 64) {
      throw new Error('User id too long for WebAuthn user handle');
    }

    const opts: GenerateRegistrationOptionsOpts = {
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userID: userIdBytes,
      userName: user.email,
      userDisplayName: user.displayName?.trim() || user.email,
      attestationType: 'none',
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
    };

    if (user.webauthnCredentialId) {
      opts.excludeCredentials = [{ id: user.webauthnCredentialId }];
    }

    const options = await generateRegistrationOptions(opts);

    registrationChallengeStore.set(userId, {
      challenge: options.challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    return options;
  }

  async verifyRegistration(userId: string, credential: RegistrationResponseJSON): Promise<boolean> {
    pruneStore(registrationChallengeStore);

    const entry = registrationChallengeStore.get(userId);
    if (!entry || entry.expiresAt <= Date.now()) {
      registrationChallengeStore.delete(userId);
      throw new Error('Challenge not found or expired');
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: entry.challenge,
      expectedOrigin: this.config.expectedOrigins,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return false;
    }

    const { credential: webauthnCredential } = verification.registrationInfo;

    await prisma.user.update({
      where: { id: userId },
      data: {
        webauthnCredentialId: webauthnCredential.id,
        webauthnPublicKey: isoBase64URL.fromBuffer(Buffer.from(webauthnCredential.publicKey), 'base64url'),
        webauthnCounter: webauthnCredential.counter,
        deviceVerified: true,
      },
    });

    registrationChallengeStore.delete(userId);
    return true;
  }

  /**
   * Begin WebAuthn authentication (prove possession of the enrolled passkey). Requires prior registration.
   */
  async generateAuthenticationOptions(
    userId: string,
  ): Promise<Awaited<ReturnType<typeof generateAuthenticationOptions>>> {
    pruneStore(authenticationChallengeStore);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        webauthnCredentialId: true,
        webauthnPublicKey: true,
        deviceVerified: true,
      },
    });

    if (!user || !user.webauthnCredentialId || !user.webauthnPublicKey) {
      throw new Error('No passkey registered for this user');
    }

    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      allowCredentials: [{ id: user.webauthnCredentialId }],
      userVerification: 'required',
      timeout: 60_000,
    });

    authenticationChallengeStore.set(userId, {
      challenge: options.challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    return options;
  }

  /**
   * Verify a WebAuthn assertion and advance the stored signature counter (replay protection).
   */
  async verifyAuthentication(userId: string, assertion: AuthenticationResponseJSON): Promise<boolean> {
    pruneStore(authenticationChallengeStore);

    const entry = authenticationChallengeStore.get(userId);
    if (!entry || entry.expiresAt <= Date.now()) {
      authenticationChallengeStore.delete(userId);
      throw new Error('Challenge not found or expired');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        webauthnCredentialId: true,
        webauthnPublicKey: true,
        webauthnCounter: true,
        deviceVerified: true,
      },
    });

    if (
      !user ||
      !user.webauthnCredentialId ||
      !user.webauthnPublicKey ||
      !isDeviceVerificationComplete(user)
    ) {
      authenticationChallengeStore.delete(userId);
      return false;
    }

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: entry.challenge,
      expectedOrigin: this.config.expectedOrigins,
      expectedRPID: this.config.rpId,
      credential: {
        id: user.webauthnCredentialId,
        publicKey: isoBase64URL.toBuffer(user.webauthnPublicKey, 'base64url'),
        counter: user.webauthnCounter,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return false;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { webauthnCounter: verification.authenticationInfo.newCounter },
    });

    authenticationChallengeStore.delete(userId);
    return true;
  }
}
