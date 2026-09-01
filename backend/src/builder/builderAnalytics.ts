import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';

export type BuilderAnalyticsEvent =
  | {
      type: 'discovery_turn';
      sessionId: string;
      messageId: string;
      phase: string;
      action: string;
      canPlan: boolean;
      factOps: number;
      unresolved: number;
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number;
      intent: string;
    }
  | {
      type: 'plan_generated';
      sessionId: string;
      planId: string;
      requirementsVersion: number;
      planType: string;
    }
  | {
      type: 'turn_failed';
      sessionId: string;
      reason: string;
    };

/**
 * Product analytics for the builder. Kept out of the model prompt; linked by
 * session/message ids for later evaluation datasets.
 */
export async function emitBuilderAnalytics(
  event: BuilderAnalyticsEvent,
  version = 0,
): Promise<void> {
  console.info('[builder-analytics]', JSON.stringify(event));
  if (event.type === 'turn_failed') return;
  try {
    await prisma.nlBuilderStateEvent.create({
      data: {
        sessionId: event.sessionId,
        messageId: event.type === 'discovery_turn' ? event.messageId : event.planId,
        eventType: `analytics_${event.type}`,
        payload: event as unknown as Prisma.InputJsonValue,
        fromVersion: version,
        toVersion: version,
      },
    });
  } catch (err) {
    console.warn('[builder-analytics] persist failed', err instanceof Error ? err.message : err);
  }
}
