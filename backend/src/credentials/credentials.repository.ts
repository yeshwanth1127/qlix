import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { VCClaims, VCType, VerifiableCredentialDTO } from './vc.types.js';

export interface CreateCredentialInput {
  agentId: string;
  agentDid: string;
  type: VCType;
  issuerDid: string;
  subjectDid: string;
  claims: VCClaims;
  signature: string;
  expiresAt?: Date | null;
}

function toDTO(record: {
  id: string;
  agentId: string;
  agentDid: string;
  type: string;
  issuerDid: string;
  subjectDid: string;
  claims: Prisma.JsonValue;
  signature: string;
  issuedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}): VerifiableCredentialDTO {
  return {
    id: record.id,
    agentId: record.agentId,
    agentDid: record.agentDid,
    type: record.type as VCType,
    issuerDid: record.issuerDid,
    subjectDid: record.subjectDid,
    claims: record.claims as VCClaims,
    signature: record.signature,
    issuedAt: record.issuedAt.toISOString(),
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
  };
}

export class CredentialsRepository {
  async create(input: CreateCredentialInput): Promise<VerifiableCredentialDTO> {
    const created = await prisma.verifiableCredential.create({
      data: {
        agentId: input.agentId,
        agentDid: input.agentDid,
        type: input.type,
        issuerDid: input.issuerDid,
        subjectDid: input.subjectDid,
        claims: input.claims as Prisma.InputJsonValue,
        signature: input.signature,
        expiresAt: input.expiresAt ?? null,
      },
    });
    return toDTO(created);
  }

  async listByAgentId(agentId: string): Promise<VerifiableCredentialDTO[]> {
    const rows = await prisma.verifiableCredential.findMany({
      where: { agentId },
      orderBy: { issuedAt: 'asc' },
    });
    return rows.map(toDTO);
  }

  async listByAgentDid(agentDid: string): Promise<VerifiableCredentialDTO[]> {
    const rows = await prisma.verifiableCredential.findMany({
      where: { agentDid, revokedAt: null },
      orderBy: { issuedAt: 'asc' },
    });
    return rows.map(toDTO);
  }
}
