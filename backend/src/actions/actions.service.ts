import crypto from 'node:crypto';
import { Prisma, type ActionLog as PrismaActionLog } from '@prisma/client';
import { verifySignature } from '../agents/keypair.js';
import { billingCycleFromDateUtc } from '../billings/lib/billingCycle.js';
import { ensureBillingDefaults } from '../billings/lib/ensureDefaults.js';
import { lookupBillingUnitPrice } from '../billings/lib/priceLookup.js';
import { prisma } from '../lib/prisma.js';
import { canonicalize } from './canonical.js';
import type {
  ActionRiskLevel,
  CompleteSignedPayload,
  StartSignedPayload,
} from './actions.types.js';

/** ±5 minutes around server clock — guards against replays. */
const SIGNATURE_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

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
    const needsJit = jitScopes.includes(signedPayload.actionType);
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

    const created = await prisma.actionLog.create({
      data: {
        agentId: agent.id,
        userId: agent.userId,
        actionType: signedPayload.actionType,
        payload: {
          phase: 'start',
          did: signedPayload.did,
          metadata: signedPayload.metadata ?? null,
          nonce: signedPayload.nonce ?? null,
        } as Prisma.InputJsonValue,
        riskLevel,
        status: 'pending',
        approvalStatus: 'not_required',
        signature,
        prevHash,
        timestampMs: BigInt(signedPayload.timestampMs),
      },
    });

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
    if (startRow.agent.did !== signedPayload.did) throw new DidMismatchError();

    await assertSignature(signedPayload, signature, startRow.agent.publicKey);

    const existingCompletion = await findCompletionFor(signedPayload.actionId);
    if (existingCompletion) throw new ActionAlreadyCompletedError();

    const eventType = signedPayload.eventType ?? startRow.actionType;
    const eventKey = signedPayload.eventKey ?? signedPayload.actionId;
    const finalStatus: 'success' | 'failed' = signedPayload.success ? 'success' : 'failed';

    if (signedPayload.success && startRow.agent.orgId) {
      await ensureBillingDefaults(prisma);
    }

    return prisma.$transaction(async (tx) => {
      const prevHash = await computePrevHashForAgentTx(tx, startRow.agentId);

      const completion = await tx.actionLog.create({
        data: {
          agentId: startRow.agentId,
          userId: startRow.userId,
          actionType: `${startRow.actionType}:complete`,
          payload: {
            phase: 'complete',
            startActionId: startRow.id,
            success: signedPayload.success,
            result: signedPayload.result ?? null,
            errorMessage: signedPayload.errorMessage ?? null,
            errorCode: signedPayload.errorCode ?? null,
          } as Prisma.InputJsonValue,
          riskLevel: startRow.riskLevel,
          status: finalStatus,
          approvalStatus: startRow.approvalStatus,
          signature,
          prevHash,
          timestampMs: BigInt(signedPayload.timestampMs),
        },
      });

      let amountCharged: Prisma.Decimal | null = null;
      let walletAfter: Prisma.Decimal | null = null;
      let successfulEventId: string | null = null;

      if (signedPayload.success && startRow.agent.orgId) {
        const occurredAt = new Date(signedPayload.timestampMs);
        const billingCycle = billingCycleFromDateUtc(occurredAt);

        const price = await lookupBillingUnitPrice({ prisma: tx as unknown as typeof prisma, eventType });
        amountCharged = price.unitPrice;

        const event = await tx.successfulEvent.upsert({
          where: {
            orgId_successfulEventKey: { orgId: startRow.agent.orgId, successfulEventKey: eventKey },
          },
          create: {
            orgId: startRow.agent.orgId,
            userId: startRow.userId,
            agentId: startRow.agentId,
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
          const wallet = await tx.wallet.findUnique({ where: { orgId: startRow.agent.orgId } });
          const orgWallet =
            wallet ??
            (await tx.wallet.create({
              data: { orgId: startRow.agent.orgId, currency: 'USD', balance: 0 },
            }));

          const updated = await tx.wallet.update({
            where: { id: orgWallet.id },
            data: { balance: { decrement: amountCharged } },
            select: { balance: true },
          });
          walletAfter = updated.balance;

          await tx.transaction.create({
            data: {
              walletId: orgWallet.id,
              actionLogId: completion.id,
              successfulEventId: event.id,
              type: 'usage_debit',
              amount: amountCharged.neg(),
              status: 'posted',
            },
          });
        }

        await tx.billingLog.create({
          data: {
            orgId: startRow.agent.orgId,
            action: 'action_complete_recorded',
            status: 'success',
            details: {
              startActionId: startRow.id,
              completionLogId: completion.id,
              eventType,
              billedServiceKey: price.serviceKey,
              billingCycle,
              amountCharged: amountCharged.toString(),
              walletAfter: walletAfter ? walletAfter.toString() : null,
            } as Prisma.InputJsonValue,
          },
        });
      }

      return {
        actionId: startRow.id,
        completionLogId: completion.id,
        status: finalStatus,
        amountCharged: amountCharged ? amountCharged.toString() : null,
        walletAfter: walletAfter ? walletAfter.toString() : null,
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
