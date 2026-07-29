import type { PermissionScope } from '../agents/agents.types.js';

export type VCType = 'identity' | 'scope' | 'jit';

export interface IdentityClaims {
  humanVerified: boolean;
  deviceVerified: boolean;
  webauthnCredentialId: string | null;
  issuedBy: string;
}

export interface ScopeClaims {
  permissionScopes: PermissionScope[];
  jitScopes: PermissionScope[];
  alwaysScopes: PermissionScope[];
}

export type VCClaims = IdentityClaims | ScopeClaims | Record<string, unknown>;

export interface VerifiableCredentialDTO {
  id: string;
  /** Null once the issuing Agent row is deleted (SetNull) — `agentDid` still identifies it. */
  agentId: string | null;
  agentDid: string;
  type: VCType;
  issuerDid: string;
  subjectDid: string;
  claims: VCClaims;
  signature: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}
