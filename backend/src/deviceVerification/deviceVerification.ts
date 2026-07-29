import { prisma } from '../lib/prisma.js';
import { isBillingExempt } from '../billings/lib/isBillingExempt.js';

/** Thrown when an operation requires a registered passkey (WebAuthn) on this account. */
export class DeviceNotVerifiedError extends Error {
  readonly code = 'device_not_verified';
  constructor() {
    super('Device verification required');
    this.name = 'DeviceNotVerifiedError';
  }
}

/** Fields needed to decide if the account has completed device enrollment. */
export interface UserDeviceVerificationFields {
  readonly deviceVerified: boolean;
  readonly webauthnCredentialId: string | null;
  readonly webauthnPublicKey: string | null;
}

/**
 * A user is considered device-verified only when the flag is set and a full passkey
 * credential row exists (credential id + public key). This guards against partial DB state.
 */
export function isDeviceVerificationComplete(fields: UserDeviceVerificationFields): boolean {
  return (
    fields.deviceVerified === true &&
    fields.webauthnCredentialId != null &&
    fields.webauthnCredentialId.length > 0 &&
    fields.webauthnPublicKey != null &&
    fields.webauthnPublicKey.length > 0
  );
}

/** Session `user` object for auth responses (`deviceVerified` is derived, not raw DB flag). */
export function sessionUserPayload(
  user: UserDeviceVerificationFields & {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
    readonly role: string;
    readonly orgId: string;
    readonly workspaceKind: string;
    readonly isSuperAdmin: boolean;
    readonly isGuest: boolean;
  },
): {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  orgId: string;
  workspaceKind: string;
  isSuperAdmin: boolean;
  isGuest: boolean;
  deviceVerified: boolean;
  billingExempt: boolean;
} {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    orgId: user.orgId,
    workspaceKind: user.workspaceKind,
    isSuperAdmin: user.isSuperAdmin,
    isGuest: user.isGuest,
    deviceVerified: isDeviceVerificationComplete(user),
    billingExempt: isBillingExempt(user.email),
  };
}

const userSelect = {
  deviceVerified: true,
  webauthnCredentialId: true,
  webauthnPublicKey: true,
  isGuest: true,
} as const;

export class DeviceVerificationService {
  /**
   * Looks up any enrolled passkey for attribution on new agents.
   * Browser session auth is enough to create agents — passkeys are optional.
   */
  async assertUserVerified(userId: string): Promise<{ webauthnCredentialId: string | null }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user) {
      throw new DeviceNotVerifiedError();
    }
    if (!isDeviceVerificationComplete(user)) {
      return { webauthnCredentialId: null };
    }
    return { webauthnCredentialId: user.webauthnCredentialId };
  }

  async getStatus(userId: string): Promise<{
    deviceVerified: boolean;
    hasPasskey: boolean;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
    if (!user) {
      return { deviceVerified: false, hasPasskey: false };
    }
    const complete = isDeviceVerificationComplete(user);
    return {
      deviceVerified: complete,
      hasPasskey: user.webauthnCredentialId != null && user.webauthnCredentialId.length > 0,
    };
  }
}
