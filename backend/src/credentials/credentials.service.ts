import { signAction } from '../agents/keypair.js';
import { CredentialsRepository } from './credentials.repository.js';
import { getPlatformIdentity } from './platformIdentity.js';
import type {
  IdentityClaims,
  ScopeClaims,
  VCClaims,
  VCType,
  VerifiableCredentialDTO,
} from './vc.types.js';

interface AgentForVC {
  id: string;
  did: string;
  webauthnCredentialId: string | null;
  permissionScopes: string[];
  jitScopes: string[];
  alwaysScopes: string[];
}

/**
 * Returns a deterministic JSON serialization of an object so the same logical
 * payload always produces the same signature input. Recursively sorts object
 * keys but preserves array order.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const inner = entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',');
  return `{${inner}}`;
}

export class CredentialsService {
  constructor(private readonly repo: CredentialsRepository = new CredentialsRepository()) {}

  /** Issues both identity and scope VCs for a freshly created agent. */
  async issueAgentVCs(agent: AgentForVC): Promise<VerifiableCredentialDTO[]> {
    const platform = await getPlatformIdentity();

    const identityClaims: IdentityClaims = {
      humanVerified: true,
      deviceVerified: true,
      webauthnCredentialId: agent.webauthnCredentialId,
      issuedBy: platform.did,
    };

    const scopeClaims: ScopeClaims = {
      permissionScopes: agent.permissionScopes as ScopeClaims['permissionScopes'],
      jitScopes: agent.jitScopes as ScopeClaims['jitScopes'],
      alwaysScopes: agent.alwaysScopes as ScopeClaims['alwaysScopes'],
    };

    const identity = await this.issue(agent, 'identity', identityClaims);
    const scope = await this.issue(agent, 'scope', scopeClaims);
    return [identity, scope];
  }

  async issue(
    agent: AgentForVC,
    type: VCType,
    claims: VCClaims,
  ): Promise<VerifiableCredentialDTO> {
    const platform = await getPlatformIdentity();
    const issuedAt = new Date().toISOString();

    const payloadObject = {
      issuer: platform.did,
      subject: agent.did,
      type,
      claims,
      issuedAt,
    };
    const payload = canonicalize(payloadObject);
    const signature = await signAction(payload, platform.privateKeyHex);

    return this.repo.create({
      agentId: agent.id,
      agentDid: agent.did,
      type,
      issuerDid: platform.did,
      subjectDid: agent.did,
      claims,
      signature,
    });
  }

  listByAgentId(agentId: string): Promise<VerifiableCredentialDTO[]> {
    return this.repo.listByAgentId(agentId);
  }

  listByAgentDid(agentDid: string): Promise<VerifiableCredentialDTO[]> {
    return this.repo.listByAgentDid(agentDid);
  }
}
