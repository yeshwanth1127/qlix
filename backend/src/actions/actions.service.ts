import crypto from 'node:crypto';
import { Prisma, type ActionLog as PrismaActionLog } from '@prisma/client';
import { verifySignature } from '../agents/keypair.js';
import { billingCycleFromDateUtc } from '../billings/lib/billingCycle.js';
import { ensureBillingDefaults } from '../billings/lib/ensureDefaults.js';
import { lookupBillingUnitPrice, lookupModelTierPrice } from '../billings/lib/priceLookup.js';
import { debitWalletTwoBucket } from '../billings/lib/recordBillingEvent.js';
import { prisma } from '../lib/prisma.js';
import { canonicalize } from './canonical.js';
import { scopeRequiresJit } from './jitScope.js';
import { isLeadListingActionType, markLeadsListed } from '../leads/leadOutreachGate.js';
import type {
  ActionRiskLevel,
  CompleteSignedPayload,
  StartSignedPayload,
} from './actions.types.js';

/** +/-5 minutes around server clock -- guards against replays. */
const SIGNATURE_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/** Remove null bytes from strings (PostgreSQL doesn't allow them in text fields) */
function sanitizeForDb(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\x00/g, '');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      sanitized[k] = sanitizeForDb(v);
    }
    return sanitized;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForDb);
  }
  return value;
}

export class AgentNotFoundError extends Error {
  readonly code = 'agent_not_found';
}

export class InvalidSignatureError extends Error {
  readonly code = 'invalid_signature';
}

export class StaleTimestampError extends Error {
  readonly code = 'stale_timestamp';
}

export class ActionNotFoundError extends Error {
  readonly code = 'action_not_found';
}

export class ActionAlreadyCompletedError extends Error {
  readonly code = 'action_already_completed';
}

export class DidMismatchError extends Error {
  readonly code = 'did_mismatch';
}

export class JitTokenRequiredError extends Error {
  readonly code = 'jit_token_required';
}

export class JitTokenInvalidError extends Error {
  readonly code = 'jit_token_invalid';
}

export interface StartResult {
  actionId: string;
  agentId: string;
  status: 'pending';
  timestampMs: number;
  signature: string;
  prevHash: string;
}

export interface CompleteResult {
  actionId: string;
  completionLogId: string;
  status: 'success' | 'failed';
  amountCharged: string | null;
  walletAfter: string | null;
  successfulEventId: string | null;
}

export class ActionsService {
  /** Validates a one-time JIT token minted by GET /api/v1/jit/poll and clears it (idempotent safe). */
  async consumeJitToken(input: {
    agentId: string;
    actionType: string;
    token: string;
  }): Promise<boolean> {
    const { agentId, actionType, token } = input;

    return prisma.$transaction(async (tx) => {
      const approval = await tx.approval.findFirst({
        where: {
          jitToken: token,
          decision: 'approved',
          actionLog: { agentId, actionType },
        },
        select: { id: true },
      });
      if (!approval) return false;
      await tx.approval.update({
        where: { id: approval.id },
        data: { jitToken: null },
      });
      return true;
    });
  }

  async start(input: { signedPayload: StartSignedPayload; signature: string }): Promise<StartResult> {
    const { signedPayload, signature } = input;

    assertFreshTimestamp(signedPayload.timestampMs);

    const agent = await prisma.agent.findUnique({ where: { did: signedPayload.did } });
    if (!agent) throw new AgentNotFoundError(`Unknown DID: ${signedPayload.did}`);

    await assertSignature(signedPayload, signature, agent.publicKey);

    const jitScopes = agent.jitScopes as string[];
    const needsJit = scopeRequiresJit(jitScopes, signedPayload.actionType);
    if (needsJit && !signedPayload.jitToken) {
      throw new JitTokenRequiredError('JIT scope requires an approved jitToken from /api/v1/jit/*');
    }
    if (!needsJit && signedPayload.jitToken) {
      throw new JitTokenInvalidError('jitToken provided for a non-JIT actionType');
    }
    if (signedPayload.jitToken) {
      const ok = await this.consumeJitToken({
        agentId: agent.id,
        actionType: signedPayload.actionType,
        token: signedPayload.jitToken,
      });
      if (!ok) throw new JitTokenInvalidError('Invalid or already used jitToken');
    }

    const prevHash = await computePrevHashForAgent(agent.id);
    const riskLevel: ActionRiskLevel = signedPayload.riskLevel ?? 'low';

    const sanitizeString = (s: unknown): unknown => {
      if (typeof s === 'string') {
        return [...s].filter((c) => c.charCodeAt(0) !== 0).join('');
      }
      if (s && typeof s === 'object') {
        if (Array.isArray(s)) return s.map(sanitizeString);
        const sanitized: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s)) {
          sanitized[k] = sanitizeString(v);
        }
        return sanitized;
      }
      return s;
    };

    const created = await prisma.actionLog.create({
      data: {
        agentId: agent.id,
        userId: agent.userId,
        actionType: signedPayload.actionType,
        payload: sanitizeString({
          phase: 'start',
          did: signedPayload.did,
          metadata: signedPayload.metadata ?? null,
          nonce: signedPayload.nonce ?? null,
        }) as Prisma.InputJsonValue,
        riskLevel,
        status: 'pending',
        approvalStatus: 'not_required',
        signature: sanitizeString(signature) as string,
        prevHash: sanitizeString(prevHash) as string,
        timestampMs: BigInt(signedPayload.timestampMs),
      },
    });

    // Lead-outreach UX gate: record when the agent lists/scrapes leads so email.send
    // can require this "present leads to the user first" step (see leadOutreachGate).
    if (isLeadListingActionType(signedPayload.actionType)) {
      await markLeadsListed(agent.id);
    }

    return {
      actionId: created.id,
      agentId: agent.id,
      status: 'pending',
      timestampMs: Number(created.timestampMs),
      signature: created.signature,
      prevHash: created.prevHash,
    };
  }

  async complete(input: {
    signedPayload: CompleteSignedPayload;
    signature: string;
  }): Promise<CompleteResult> {
    const { signedPayload, signature } = input;

    assertFreshTimestamp(signedPayload.timestampMs);

    const startRow = await prisma.actionLog.findUnique({
      where: { id: signedPayload.actionId },
      include: { agent: true },
    });
    if (!startRow) throw new ActionNotFoundError(`No action with id ${signedPayload.actionId}`);
    // `agent` can be null once ActionLog.agentId is SetNull'd by an agent deletion — an
    // in-flight completion for a just-deleted agent has nothing left to verify against.
    const agent = startRow.agent;
    if (!agent) throw new ActionNotFoundError(`Agent for action ${signedPayload.actionId} no longer exists`);
    if (agent.did !== signedPayload.did) throw new DidMismatchError();

    await assertSignature(signedPayload, signature, agent.publicKey);

    const existingCompletion = await findCompletionFor(signedPayload.actionId);
    if (existingCompletion) throw new ActionAlreadyCompletedError();

    const eventType = signedPayload.eventType ?? startRow.actionType;
    const eventKey = signedPayload.eventKey ?? signedPayload.actionId;
    const finalStatus: 'success' | 'failed' = signedPayload.success ? 'success' : 'failed';

    if (signedPayload.success && agent.orgId) {
      await ensureBillingDefaults(prisma);
    }

    return prisma.$transaction(async (tx) => {
      const prevHash = await computePrevHashForAgentTx(tx, agent.id);

      const sanitizeString = (s: unknown): unknown => {
        if (typeof s === 'string') { return [...s].filter(c => c.charCodeAt(0) !== 0).join(''); }
        if (s && typeof s === 'object') {
          if (Array.isArray(s)) return s.map(sanitizeString);
          const sanitized: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(s)) {
            sanitized[k] = sanitizeString(v);
          }
          return sanitized;
        }
        return s;
      };

      const completion = await tx.actionLog.create({
        data: {
          agentId: agent.id,
          userId: startRow.userId,
          actionType: `${startRow.actionType}:complete`,
          payload: sanitizeString({
            phase: 'complete',
            startActionId: startRow.id,
            success: signedPayload.success,
            result: signedPayload.result ?? null,
            errorMessage: signedPayload.errorMessage ?? null,
            errorCode: signedPayload.errorCode ?? null,
          }) as Prisma.InputJsonValue,
          riskLevel: startRow.riskLevel,
          status: finalStatus,
          approvalStatus: startRow.approvalStatus,
          signature: sanitizeString(signature) as string,
          prevHash: sanitizeString(prevHash) as string,
          timestampMs: BigInt(signedPayload.timestampMs),
        },
      });

      let amountCharged: Prisma.Decimal | null = null;
      let successfulEventId: string | null = null;

      if (signedPayload.success && agent.orgId) {
        const occurredAt = new Date(signedPayload.timestampMs);
        const billingCycle = billingCycleFromDateUtc(occurredAt);

        // For agent_run steps, use model-tier pricing based on the agent's configured model.
        // All other event types (passport, audit, jit_detection, etc.) use flat service pricing.
        const isAgentStep = eventType === 'agent_run' || eventType === 'agent_step';
        let pricedServiceKey: string;
        if (isAgentStep && agent.llmModel) {
          const tierPrice = await lookupModelTierPrice({ prisma, modelId: agent.llmModel });
          amountCharged = tierPrice.pricePerStep;
          pricedServiceKey = `model_tier:${tierPrice.tierKey}`;
        } else {
          const price = await lookupBillingUnitPrice({ prisma, eventType });
          amountCharged = price.unitPrice;
          pricedServiceKey = price.serviceKey;
        }

        const event = await tx.successfulEvent.upsert({
          where: {
            orgId_successfulEventKey: { orgId: agent.orgId, successfulEventKey: eventKey },
          },
          create: {
            orgId: agent.orgId,
            userId: startRow.userId,
            agentId: agent.id,
            eventType,
            amountCharged,
            billingCycle,
            successfulEventKey: eventKey,
            apiEndpoint: '/api/v1/actions/complete',
            occurredAt,
            eventData: {
              startActionId: startRow.id,
              completionLogId: completion.id,
            } as Prisma.InputJsonValue,
          },
          update: {},
        });
        successfulEventId = event.id;

        // Upsert may have hit an existing event from a retry; guard the debit
        // against double-charge by checking for an existing usage_debit transaction.
        const existingTx = await tx.transaction.findFirst({
          where: { successfulEventId: event.id, type: 'usage_debit' },
          select: { id: true },
        });

        if (!existingTx && amountCharged.gt(0)) {
          await debitWalletTwoBucket(tx, agent.orgId, amountCharged, event.id, prisma);
        }

        await tx.billingLog.create({
          data: {
            orgId: agent.orgId,
            action: 'action_complete_recorded',
            status: 'success',
            details: {
              startActionId: startRow.id,
              completionLogId: completion.id,
              eventType,
              billedServiceKey: pricedServiceKey,
              billingCycle,
              amountCharged: amountCharged.toString(),
            } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        actionId: startRow.id,
        completionLogId: completion.id,
        status: finalStatus,
        amountCharged: amountCharged ? amountCharged.toString() : null,
        walletAfter: null,
        successfulEventId,
      };
    });
  }
}

function assertFreshTimestamp(timestampMs: number): void {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
    throw new StaleTimestampError('timestampMs missing or non-finite');
  }
  const drift = Math.abs(Date.now() - timestampMs);
  if (drift > SIGNATURE_FRESHNESS_WINDOW_MS) {
    throw new StaleTimestampError(`timestamp drift ${drift}ms exceeds window`);
  }
}

async function assertSignature(
  signedPayload: unknown,
  signatureHex: string,
  agentPublicKeyHex: string,
): Promise<void> {
  const message = canonicalize(signedPayload);
  const ok = await verifySignature(message, signatureHex, agentPublicKeyHex).catch(() => false);
  if (!ok) throw new InvalidSignatureError();
}

async function computePrevHashForAgent(agentId: string): Promise<string> {
  const last = await prisma.actionLog.findFirst({
    where: { agentId },
    orderBy: { timestampMs: 'desc' },
    select: { signature: true },
  });
  return last ? sha256Hex(last.signature) : '';
}

async function computePrevHashForAgentTx(
  tx: Prisma.TransactionClient,
  agentId: string,
): Promise<string> {
  const last = await tx.actionLog.findFirst({
    where: { agentId },
    orderBy: { timestampMs: 'desc' },
    select: { signature: true },
  });
  return last ? sha256Hex(last.signature) : '';
}

async function findCompletionFor(startActionId: string): Promise<PrismaActionLog | null> {
  return prisma.actionLog.findFirst({
    where: {
      payload: { path: ['startActionId'], equals: startActionId },
    },
  });
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
